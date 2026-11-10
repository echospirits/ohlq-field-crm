import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { configuredProducts, getProductionDashboard, getProductionProduct, summaryFor } from '../lib/productionForecasting/service';
import { ohioItemContext, normalizeNativeOhio } from '../lib/productionForecasting/ohio';
import { importProductionSource, parseProductionSource } from '../lib/productionForecasting/import';
import { forecastProduct } from '../lib/productionForecasting/engine';
import { getOrganizationTenantConfig } from '../lib/tenantConfig';

const product = (code: string, market = 'OH') => ({ id: `${market}-${code}`, market, externalItemCode: code, displayName: code, active: true, discontinued: false, status: code === '3150B' ? 'EXCLUDED' : 'OWNED' });
function fixture() {
  const products = ['ACTIVE', 'BAIL', 'DIST', 'DELISTED', 'UNKNOWN', '3150B', 'FOREIGN'].map(code => product(code));
  products.push(product('DELISTED', 'FL'));
  const forecastBailmentProducts = ['ACTIVE', 'BAIL', 'DELISTED', '3150B'].map(itemCode => ({ itemCode, itemName: `Name ${itemCode}`, vendorId: 'VENDOR' }));
  forecastBailmentProducts.push({ itemCode: 'FOREIGN', itemName: 'Other vendor', vendorId: 'OTHER' });
  const diagnostics = { distilleryOnlyItemCodes: ['DIST'], forecastBailmentProducts };
  const vendors = [{ vendorId: 'VENDOR' }];
  const snapshots = products.map(p => ({ productId: p.id, summary: { ...summaryFor(forecastProduct({ id: p.id, code: p.externalItemCode, name: p.displayName, market: p.market }, [], [], '2026-10-27')), point: p.market === 'OH' && ['DIST', 'DELISTED'].includes(p.externalItemCode) ? 9999 : 10, target: 10 } }));
  const where: Array<Record<string, any>> = [], snapshotReads: unknown[] = [], identityWrites: any[] = [], observations: any[] = [];
  let detailReads = 0;
  const db = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
    $executeRaw: async () => 0,
    organization: { findFirst: async () => ({ id: 'org_echo_spirits', enabledStates: ['OH', 'FL'], timezone: 'America/New_York', settings: {} }), findUnique: async () => ({ id: 'org_echo_spirits', products: products.filter(p => p.active && p.status === 'OWNED'), vendorIdentifiers: vendors }) },
    organizationVendorIdentifier: { findMany: async (args: any) => { assert.deepEqual(args.where, { organizationId: 'org_echo_spirits', market: 'OH', active: true }); return vendors; } },
    organizationProduct: {
      findMany: async (args: { where: Record<string, any> }) => {
        where.push(args.where); assert.equal(args.where.organizationId, 'org_echo_spirits');
        if (args.where.OR) return products.filter(p => !p.discontinued && (p.market === 'OH' ? args.where.OR[1].externalItemCode.in.includes(p.externalItemCode) : args.where.OR[0].market.in.includes(p.market) && p.active && p.status === 'OWNED'));
        assert.equal(args.where.market, 'OH'); assert.equal(args.where.active, true); assert.deepEqual(args.where.status, { in: ['OWNED', 'REPRESENTED'] });
        return products.filter(p => p.market === 'OH' && p.active && p.status === 'OWNED');
      },
      createMany: async (args: any) => { identityWrites.push(args); return { count: 0 }; },
    },
    ohlqAgencyInventoryCurrent: { findMany: async () => [{ itemCode: 'BAIL', itemName: 'Bail', vendorId: 'VENDOR', detailCodeDescription: 'A3A Bailment' }, { itemCode: 'DIST', itemName: 'Dist', vendorId: 'VENDOR', detailCodeDescription: 'A3A Distillery Only' }] },
    ohlqTenantInventoryImportStatus: { findFirst: async () => ({ diagnostics }) },
    ohlqBrandMasterItem: { findMany: async () => [{ itemCode: 'DELISTED', solItemStatusCode: ' 30 ' }] },
    productionForecastRun: { findFirst: async () => ({ id: 'run', generatedAt: new Date('2026-10-28T12:00:00Z'), horizonStart: new Date('2026-10-28'), horizonEnd: new Date('2026-11-26'), dataThrough: new Date('2026-10-27'), sourceSummary: {} }) },
    productionForecastSnapshot: {
      findMany: async (args: any) => { snapshotReads.push(args); return typeof args.where.productId === 'string' ? [] : snapshots; },
      findFirst: async () => { detailReads++; return { detail: null }; },
    },
    productionSourceImport: { findMany: async () => [], findUnique: async () => null, create: async () => ({ id: 'import' }) },
    productionDemandObservation: { createMany: async (args: any) => { observations.push(...args.data); } },
  } as unknown as PrismaClient;
  return { db, products, diagnostics, vendors, snapshots, where, snapshotReads, identityWrites, observations, detailReads: () => detailReads };
}

test('forecast scope uses vendor A3A BAIL including sales-excluded3150B; non-Ohio portfolio stays unchanged', async () => {
  const f = fixture(), before = JSON.stringify(f.products);
  const selected = await configuredProducts(f.db, 'org_echo_spirits', ['OH', 'FL']);
  assert.deepEqual(selected.map(p => `${p.market}:${p.code}`), ['OH:ACTIVE', 'OH:BAIL', 'OH:3150B', 'FL:DELISTED']);
  assert.ok(selected.every(p => !p.demandExcluded));
  assert.equal(JSON.stringify(f.products), before); assert.equal(f.identityWrites.length, 0, 'reads never change product decisions');
  const sales = await getOrganizationTenantConfig('org_echo_spirits', f.db);
  assert.equal(sales.productFilter.itemCodes.includes('3150B'), false);
  assert.equal(f.products.find(p => p.externalItemCode === '3150B')?.status, 'EXCLUDED');
});

test('saved ineligible snapshots never return as rows; newly eligible items have honest missing coverage', async () => {
  const f = fixture(), before = JSON.stringify(f.snapshots);
  f.snapshots.splice(f.snapshots.findIndex(s => s.productId === 'OH-3150B'), 1);
  const dashboard = await getProductionDashboard('org_echo_spirits', f.db);
  assert.deepEqual(dashboard.rows.map(r => r.product.id), ['OH-ACTIVE', 'OH-BAIL', 'OH-3150B', 'FL-DELISTED']);
  assert.equal(dashboard.rows.find(r => r.product.code === '3150B')?.point, null);
  assert.equal(dashboard.rows.reduce((n, r) => n + (r.point ?? 0), 0), 30);
  const selected = f.snapshotReads[0] as { where: { organizationId: string; productId: { in: string[] } } };
  assert.equal(selected.where.organizationId, 'org_echo_spirits');
  for (const code of ['DIST', 'DELISTED', 'UNKNOWN', 'FOREIGN']) assert.equal(selected.where.productId.in.includes(`OH-${code}`), false);
  assert.equal(f.snapshots.length, JSON.parse(before).length - 1);
});

test('direct links recheck vendor/classification and keep immutable saved evidence', async () => {
  for (const id of ['OH-DIST', 'OH-DELISTED', 'OH-UNKNOWN', 'OH-FOREIGN']) {
    const f = fixture(); assert.equal(await getProductionProduct('org_echo_spirits', id, f.db), null);
    assert.equal(f.detailReads(), 0); assert.equal(f.snapshotReads.length, 0);
  }
  const f = fixture(), before = JSON.stringify(f.snapshots);
  assert.ok(await getProductionProduct('org_echo_spirits', 'OH-3150B', f.db));
  f.vendors.splice(0);
  assert.equal(await getProductionProduct('org_echo_spirits', 'OH-3150B', f.db), null);
  assert.equal(JSON.stringify(f.snapshots), before);
});

test('an explicit empty complete vendor catalog does not revive retained inventory', async () => {
  const f = fixture(); f.diagnostics.forecastBailmentProducts.splice(0);
  assert.deepEqual(await configuredProducts(f.db, 'org_echo_spirits', ['OH']), []);
});

test('forecast-only source imports retain cases and create only excluded inactive identities', async () => {
  const f = fixture(), before = JSON.stringify(f.products);
  const csv = 'source_line_id,movement_date,available_on,item_code,location_code,location_name,classification,transaction_status,cases\ninvoice,2026-10-20,2026-10-20,3150B,GPT,Groveport,A3A_BAIL,SHIPPED,2';
  await importProductionSource(csv, { organizationId: 'org_echo_spirits', market: 'OH', source: 'BAILMENT_PO_INVOICE', start: '2026-10-20', end: '2026-10-20', observedOn: '2026-10-21', complete: true }, f.db);
  assert.equal(f.observations[0].itemCode, '3150B'); assert.equal(f.observations[0].cases, 2);
  assert.ok(f.identityWrites[0].skipDuplicates);
  assert.ok(f.identityWrites[0].data.every((p: any) => p.status === 'EXCLUDED' && p.active === false && p.organizationId === 'org_echo_spirits'));
  assert.equal(JSON.stringify(f.products), before);
  await assert.rejects(() => importProductionSource(csv.replace('3150B', 'UNRELATED'), { organizationId: 'org_echo_spirits', market: 'OH', source: 'BAILMENT_PO_INVOICE', start: '2026-10-20', end: '2026-10-20', observedOn: '2026-10-21', complete: true }, f.db), /No unrelated items/);
});

test('full native exports establish zero coverage for vendor bailment items absent from movements', async () => {
  const f = fixture(), context = await ohioItemContext(f.db, 'org_echo_spirits');
  const csv = 'Invoice_Date,Invoice_Number,PO_Number,Transfer_Order_Number,Agency,Transfer_Order_Ship_Date,Brand,DC_Name,Cases,Odd_Bottles,Cases_Bottles\n10/20/2026,I,P,T,1,10/20/2026,BAIL,GPT,2,0,C6';
  const native = normalizeNativeOhio(csv, 'BAILMENT_PO_INVOICE', context, { start: '2026-10-20', end: '2026-10-20', fullPortfolio: true, directInvoices: 'invoice-date' })!;
  const parsed = parseProductionSource(native.csv, { organizationId: 'org_echo_spirits', market: 'OH', source: 'BAILMENT_PO_INVOICE', start: '2026-10-20', end: '2026-10-20', observedOn: '2026-10-21', complete: true });
  assert.equal(parsed.rows.filter(r => r.itemCode === '3150B').length, 2);
  assert.ok(parsed.rows.filter(r => r.itemCode === '3150B').every(r => r.cases === 0 && r.classification === 'A3A_BAIL'));
});
