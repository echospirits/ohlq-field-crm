import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import { DC_INVENTORY_REPORT_ID, parseDcInventoryCsv, type DcInventoryDownload } from '../lib/productionForecasting/operationalSignals/dcInventory';
import { dcInventoryAlreadyObservedToday, getDcInventorySignals, ingestDcInventory } from '../lib/productionForecasting/operationalSignals/dcInventoryIngestion';
import { getWarehouseBalanceSignals, warehouseBalanceFor } from '../lib/productionForecasting/operationalSignals/warehouseBalance';
import type { CurrentDemandSignal } from '../lib/productionForecasting/operationalSignals/demandIngestion';

const header = 'Vendor_Name,Vendor_Number,Broker_Number,Broker_Name,As_of_Date,Brand_Code,Name,Status,Case_Count,GPT_Quantity,GPT_Picked,GPTR_Quantity,GRN_Quantity,GRN_Picked,GRNR_Quantity,Total';
const row = ({ code = '3150B', vendor = 'VENDOR', date = '11/10/2026', status = '70', gpt = '10.00', gptPicked = '0.00', grn = '18.00', grnPicked = '1.00', gptr = '999.00', grnr = '888.00' }: { code?: string; vendor?: string; date?: string; status?: string; gpt?: string; gptPicked?: string; grn?: string; grnPicked?: string; gptr?: string; grnr?: string } = {}) => ['Example Vendor', vendor, '', '', date, code, 'Example product', status, 'C6', gpt, gptPicked, gptr, grn, grnPicked, grnr, '1816.00'].join(',');
const options = { businessDate: '2026-11-10', vendorIds: ['VENDOR'], itemCodes: ['3150B', '2806B'] };
const csv = (...rows: string[]) => [header, ...rows].join('\n');
const now = new Date('2026-11-10T13:00:00Z');
const organizationId = 'org_echo_spirits';
const download = (value = csv(row(), row({ code: '2806B', gpt: '0', gptPicked: '0', grn: '0', grnPicked: '0' }))): DcInventoryDownload => ({ status: 'ok', csv: value, observedAt: now.toISOString(), reportDate: '2026-11-10' });
const downloadAt = (value: string, at: Date): Extract<DcInventoryDownload, { status: 'ok' }> => ({ status: 'ok', csv: value, observedAt: at.toISOString(), reportDate: options.businessDate });

test('verified native DC report includes Quantity + Picked cases per warehouse and excludes both R quantities', () => {
  const parsed = parseDcInventoryCsv(csv(row()), options), product = parsed.products[0];
  assert.equal(product.warehouses.GPT.inventoryCases, 10);
  assert.equal(product.warehouses.GRN.inventoryCases, 19);
  assert.equal(product.warehouses.GRN.quantityCases, 18); assert.equal(product.warehouses.GRN.pickedCases, 1);
  assert.equal(product.sourceBusinessDate, '2026-11-10');
  assert.equal(product.evidence.reportId, DC_INVENTORY_REPORT_ID);
  assert.deepEqual(product.evidence.excluded, ['GPTR_Quantity', 'GRNR_Quantity']);
  assert.equal(product.evidence.sourceUpdatedAt, undefined, 'the date-only report does not establish a publication clock');
});

test('explicit zero and fractional cases remain known; absence is never synthesized as zero', () => {
  const result = parseDcInventoryCsv(csv(row({ gpt: '0', gptPicked: '0', grn: '0.125', grnPicked: '0.25' })), options);
  assert.equal(result.products[0].warehouses.GPT.inventoryCases, 0);
  assert.equal(result.products[0].warehouses.GRN.inventoryCases, 0.375);
  assert.equal(result.products.some(product => product.itemCode === '2806B'), false);
});

test('foreign vendors, unconfigured codes and delisted source status cannot supply current inventory', () => {
  const result = parseDcInventoryCsv(csv(row({ code: 'UNRELATED' }), row({ vendor: 'OTHER' }), row({ status: '30' })), options);
  assert.equal(result.outsideScopeRows, 2); assert.equal(result.products.length, 1);
  assert.equal(result.products[0].warehouses.GPT.reason, 'SOURCE_INELIGIBLE');
});

test('invalid quantity affects its own warehouse; negatives and missing cells do not become zero', () => {
  for (const gpt of ['-1', '', 'not-a-number']) {
    const product = parseDcInventoryCsv(csv(row({ gpt })), options).products[0];
    assert.equal(product.warehouses.GPT.inventoryCases, null); assert.equal(product.warehouses.GPT.reason, 'INVALID_QUANTITY');
    assert.equal(product.warehouses.GRN.inventoryCases, 19);
  }
});

test('malformed files, duplicate headers and incomplete source identities reject the complete export', () => {
  for (const value of [header, csv(row()).replace('GPT_Picked,', ''), csv(row()).replace('GPT_Picked', 'GPT_Quantity'), csv(row({ vendor: '' })), csv(row()) + ',EXTRA']) {
    assert.throws(() => parseDcInventoryCsv(value, options));
  }
});

test('report As-of date is checked independently of requested report day and retrieval time', () => {
  for (const [date, reason] of [['11/09/2026', 'STALE_SOURCE'], ['11/11/2026', 'INVALID_SOURCE_DATE'], ['02/30/2026', 'INVALID_SOURCE_DATE'], ['', 'INVALID_SOURCE_DATE']]) {
    assert.equal(parseDcInventoryCsv(csv(row({ date })), options).products[0].warehouses.GPT.reason, reason);
  }
});

test('identical duplicate rows deduplicate; conflicting native product rows fail closed', () => {
  const identical = parseDcInventoryCsv(csv(row(), row()), options);
  assert.equal(identical.products.length, 1); assert.equal(identical.duplicateRows, 1);
  assert.equal(identical.products[0].warehouses.GPT.inventoryCases, 10);
  const conflict = parseDcInventoryCsv(csv(row(), row({ grnPicked: '2' })), options).products[0];
  assert.equal(conflict.warehouses.GPT.reason, 'CONFLICTING_PRODUCT_ROWS');
  assert.equal(conflict.warehouses.GRN.inventoryCases, null);
});

function fixture({ revoke = false, codes = ['3150B', '2806B'] }: { revoke?: boolean; codes?: string[] } = {}) {
  const products = codes.map(code => ({ id: `product-${code}`, market: 'OH', externalItemCode: code, displayName: `Example ${code}`, status: code === '3150B' ? 'EXCLUDED' : 'OWNED', active: code !== '3150B', discontinued: false }));
  const observations: any[] = [], checks: any[] = [], demandObservations: any[] = [], demandChecks: any[] = [];
  let active = true;
  const scoped = (args: any) => assert.equal(args.where.organizationId, organizationId);
  const matches = (record: any, where: any) => record.organizationId === where.organizationId && (!where.productId || typeof where.productId === 'string' ? !where.productId || record.productId === where.productId : where.productId.in.includes(record.productId)) && (!where.locationCode || where.locationCode.in.includes(record.locationCode)) && (!where.businessDate || String(record.businessDate) === String(where.businessDate)) && (!where.sourceBusinessDate || String(record.sourceBusinessDate) === String(where.sourceBusinessDate));
  const pairKey = (record: any) => `${record.productId}:${record.locationCode ?? ''}`;
  const read = (records: any[], args: any) => {
    scoped(args); assert.equal(args.select.evidence, undefined, 'compact readers never transfer raw native evidence');
    const selected = records.filter(record => matches(record, args.where)).sort((a, b) => b.businessDate.getTime() - a.businessDate.getTime() || (b.sourceObservedAt ?? b.checkedAt).getTime() - (a.sourceObservedAt ?? a.checkedAt).getTime() || String(b.id ?? '').localeCompare(String(a.id ?? '')));
    return args.distinct ? selected.filter((record, index) => selected.findIndex(other => pairKey(other) === pairKey(record)) === index) : selected;
  };
  const tx: Record<string, any> = {
    $executeRaw: async () => { if (revoke) active = false; return 0; },
    $queryRaw: async (query: Prisma.Sql) => {
      const text = query.strings.join(''); assert.match(text, /SELECT DISTINCT ON/); assert.doesNotMatch(text, /evidence/); assert.match(text, /"id" DESC/);
      assert.equal(query.values[0], organizationId);
      return read(text.includes('FROM "CurrentDcInventoryObservation"') ? observations : checks, { where: { organizationId, productId: { in: products.map(product => product.id) } }, select: {}, distinct: true });
    },
    organization: { findFirst: async () => ({ id: organizationId, enabledStates: ['OH'], timezone: 'America/New_York', settings: {} }) },
    organizationProduct: { findMany: async (args: any) => { scoped(args); return products.filter(product => args.where.OR ? args.where.OR[1].externalItemCode.in.includes(product.externalItemCode) : product.status === 'OWNED' && product.active); } },
    organizationVendorIdentifier: { findMany: async (args: any) => { scoped(args); assert.equal(args.where.market, 'OH'); assert.equal(args.where.active, true); return active ? [{ vendorId: 'VENDOR' }] : []; } },
    ohlqAgencyInventoryCurrent: { findMany: async () => [] },
    ohlqTenantInventoryImportStatus: { findFirst: async () => ({ diagnostics: { forecastBailmentProducts: products.map(product => ({ itemCode: product.externalItemCode, itemName: product.displayName, vendorId: 'VENDOR' })) } }) },
    ohlqBrandMasterItem: { findMany: async () => [] },
    currentDcInventoryObservation: {
      findMany: async (args: any) => { if (args.select.sourceObservedAt) assert.deepEqual(args.orderBy, [{ sourceObservedAt: 'desc' }, { id: 'desc' }]); return read(observations, args); },
      create: async ({ data }: any) => {
        assert.equal(data.organizationId, organizationId);
        assert.equal(observations.some(old => old.productId === data.productId && old.locationCode === data.locationCode && old.businessDate.getTime() === data.businessDate.getTime() && old.sourceObservedAt.getTime() === data.sourceObservedAt.getTime()), false, 'retrieval-instant uniqueness rejects duplicate facts');
        const observation = { ...data, id: `inventory-${observations.length}` }; observations.push(observation); return { id: observation.id };
      },
    },
    currentDcInventoryCheck: {
      findMany: async (args: any) => read(checks, args),
      upsert: async ({ where, create, update }: any) => { const key = where.organizationId_productId_locationCode_businessDate; assert.equal(key.organizationId, organizationId); const old = checks.find(record => record.productId === key.productId && record.locationCode === key.locationCode && String(record.businessDate) === String(key.businessDate)); if (old) Object.assign(old, update); else checks.push(create); },
    },
    currentDemandObservation: { findMany: async (args: any) => read(demandObservations, args) },
    currentDemandCheck: { findMany: async (args: any) => read(demandChecks, args) },
  };
  const client = { ...tx, $transaction: async (work: (tx: any) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  return { client, observations, checks, products, demandObservations, demandChecks };
}

test('warehouse ingestion is scoped and idempotent, retaining sales-excluded identities without mutation', async () => {
  const f = fixture(), productsBefore = JSON.stringify(f.products);
  assert.equal(await dcInventoryAlreadyObservedToday(organizationId, f.client, now), false);
  const first = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  assert.equal(first.available, 4); assert.equal(first.failed, 0);
  assert.equal(f.observations.find(row => row.itemCode === '3150B' && row.locationCode === 'GRN')?.inventoryCases, 19);
  assert.ok(f.observations.every(row => row.sourceUpdatedAt === null));
  const before = JSON.stringify(f.observations);
  const replay = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(csv(row({ gpt: '999' }), row({ code: '2806B' }))), db: f.client, now });
  assert.equal(replay.reused, 4); assert.equal(JSON.stringify(f.observations), before);
  assert.equal(await dcInventoryAlreadyObservedToday(organizationId, f.client, now), true);
  assert.equal(JSON.stringify(f.products), productsBefore, 'inventory never enrolls an item in the sales portfolio');
});

test('per-warehouse recovery preserves good facts and does not infer zero for a missing product', async () => {
  const f = fixture();
  const first = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(csv(row({ gpt: '' }))), db: f.client, now });
  assert.equal(first.available, 1); assert.equal(first.unavailable, 3);
  assert.equal(f.observations[0].locationCode, 'GRN');
  const grn = JSON.stringify(f.observations[0]);
  assert.equal(await dcInventoryAlreadyObservedToday(organizationId, f.client, now), false);
  const recovery = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  assert.equal(recovery.available, 3); assert.equal(recovery.reused, 1);
  assert.equal(JSON.stringify(f.observations[0]), grn);
});

test('failed source attempts record safe checks while retaining raw good warehouse amounts', async () => {
  const f = fixture();
  await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  const before = JSON.stringify(f.observations);
  const failed = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: { status: 'failed', observedAt: now.toISOString(), reason: 'upstream-unavailable' }, db: f.client, now });
  assert.equal(failed.failed, 4); assert.equal(JSON.stringify(f.observations), before);
  const signal = (await getDcInventorySignals(organizationId, f.client, now)).rows.find(row => row.itemCode === '3150B')!;
  assert.equal(signal.byWarehouse.GPT, 10); assert.equal(signal.status, 'FAILED'); assert.equal(signal.retained, true);
  assert.equal(signal.sourceBusinessDate, '2026-11-10'); assert.equal(signal.sourceUpdatedAt, null);
});

test('invalid complete CSV and stale source days cannot create current observations', async () => {
  for (const value of [csv(row()).replace('Brand_Code', 'Unknown'), csv(row({ date: '11/09/2026' }))]) {
    const f = fixture();
    const result = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(value), db: f.client, now });
    assert.equal(result.available, 0); assert.equal(f.observations.length, 0); assert.equal(f.checks.length, 4);
  }
});

test('ingestion rechecks revoked vendor scope and denies a foreign tenant before writes', async () => {
  const f = fixture({ revoke: true });
  const result = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  assert.equal(result.results.length, 0); assert.equal(f.observations.length, 0); assert.equal(f.checks.length, 0);
  await assert.rejects(() => ingestDcInventory({ organizationId: 'outside', businessDate: options.businessDate, download: download(), db: f.client, now }));
});

function demand(overrides: Partial<CurrentDemandSignal> = {}): CurrentDemandSignal {
  return { productId: 'product-3150B', itemCode: '3150B', productName: 'Example 3150B', status: 'AVAILABLE', reason: null, businessDate: '2026-11-10', grossCases: 35, demandCases: 35, inboundCases: null, bottlesPerCase: 6, agencyCount: 2, byWarehouse: { GPT: 12, GRN: 20, UNASSIGNED: 3 }, sourceObservedAt: now.toISOString(), sourceUpdatedAt: '2026-11-10T07:01:00Z', sourceUpdatedAtOrigin: 'OPS_PRODUCTS_FOOTNOTE', sourceUpdatedAtStatus: 'KNOWN', observedAgeMinutes: 0, sourceAgeMinutes: 359, sourceFreshness: 'CURRENT', checkedAt: now.toISOString(), checkDate: '2026-11-10', stale: false, retained: false, method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE', ...overrides };
}

test('balances use each warehouse independently, retain negative shortfalls and leave unassigned demand explicit', async () => {
  const f = fixture(); await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  const inventory = (await getDcInventorySignals(organizationId, f.client, now)).rows.find(row => row.itemCode === '3150B')!;
  const balance = warehouseBalanceFor(demand(), inventory, options.businessDate);
  assert.deepEqual(balance.warehouses.GPT, { demandCases: 12, inventoryCases: 10, balanceCases: -2, status: 'AVAILABLE' });
  assert.equal(balance.warehouses.GRN.balanceCases, -1); assert.equal(balance.demand.byWarehouse.UNASSIGNED, 3);
  assert.equal(warehouseBalanceFor(demand({ byWarehouse: { GPT: 10, GRN: 19, UNASSIGNED: 0 } }), inventory, options.businessDate).warehouses.GPT.balanceCases, 0);
});

test('stale or unknown demand source, failed inventory, and missing warehouse data withhold actionable balance', async () => {
  const f = fixture(); await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(csv(row({ grn: '' }))), db: f.client, now });
  const inventory = (await getDcInventorySignals(organizationId, f.client, now)).rows.find(row => row.itemCode === '3150B')!;
  assert.equal(warehouseBalanceFor(demand(), inventory, options.businessDate).warehouses.GRN.balanceCases, null);
  assert.equal(warehouseBalanceFor(demand(), inventory, options.businessDate).warehouses.GPT.balanceCases, -2);
  for (const partial of [{ sourceFreshness: 'UNKNOWN' as const, sourceUpdatedAt: null }, { demandCases: null }, { stale: true }, { businessDate: '2026-11-09' }, { status: 'FAILED' as const }]) {
    const balance = warehouseBalanceFor(demand(partial), inventory, options.businessDate);
    assert.equal(balance.warehouses.GPT.balanceCases, null); assert.equal(balance.warehouses.GPT.inventoryCases, 10);
  }
  const tomorrow = new Date('2026-11-11T13:00:00Z'), retained = (await getDcInventorySignals(organizationId, f.client, tomorrow)).rows.find(row => row.itemCode === '3150B')!;
  assert.equal(retained.stale, true); assert.equal(retained.byWarehouse.GPT, 10);
  assert.equal(warehouseBalanceFor(demand(), retained, '2026-11-11').warehouses.GPT.status, 'STALE');
});

test('shared server balance reader returns all eligible products from compact persisted sources', async () => {
  const f = fixture(); await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  for (const product of f.products) {
    f.demandObservations.push({ organizationId, productId: product.id, businessDate: new Date(options.businessDate), sourceObservedAt: now, sourceUpdatedAt: new Date('2026-11-10T07:01:00Z'), grossCases: 35, demandCases: 35, inboundCases: null, bottlesPerCase: 6, agencyCount: 2, summary: { byWarehouse: { GPT: 12, GRN: 20, UNASSIGNED: 3 }, sourceUpdatedAtOrigin: 'OPS_PRODUCTS_FOOTNOTE', sourceUpdatedAtStatus: 'KNOWN' } });
  }
  const result = await getWarehouseBalanceSignals(organizationId, f.client, now);
  assert.equal(result.rows.length, 2); assert.equal(result.rows.find(row => row.itemCode === '3150B')?.warehouses.GRN.balanceCases, -1);
  assert.ok(result.rows.every(row => row.demand.byWarehouse.UNASSIGNED === 3));
});

test('manual same-day inventory refresh changes 2802B GPT from 18 to 37 without rewriting accepted facts or the sales portfolio', async () => {
  const f = fixture({ codes: ['3150B', '2802B'] }), productsBefore = JSON.stringify(f.products);
  const initialCsv = csv(row(), row({ code: '2802B', gpt: '18', gptPicked: '0', grn: '5', grnPicked: '1' }));
  const freshCsv = csv(row(), row({ code: '2802B', gpt: '35', gptPicked: '2', grn: '5', grnPicked: '1' }));
  await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(initialCsv), db: f.client, now });
  const originalFacts = JSON.stringify(f.observations), later = new Date('2026-11-10T14:00:00Z'), refreshedAt = new Date('2026-11-10T15:00:00Z');
  const daily = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: downloadAt(freshCsv, later), db: f.client, now: later });
  assert.equal(daily.reused, 4); assert.equal(JSON.stringify(f.observations), originalFacts, 'daily work keeps its existing reuse behavior');
  const refreshed = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: downloadAt(freshCsv, refreshedAt), refresh: true, db: f.client, now: refreshedAt });
  assert.equal(refreshed.available, 4); assert.equal(refreshed.reused, 0); assert.equal(f.observations.length, 8);
  assert.equal(JSON.stringify(f.observations.slice(0, 4)), originalFacts, 'prior accepted retrievals remain immutable');
  const signal = (await getDcInventorySignals(organizationId, f.client, refreshedAt)).rows.find(item => item.itemCode === '2802B')!;
  assert.equal(signal.byWarehouse.GPT, 37); assert.equal(signal.warehouses.GPT.quantityCases, 35); assert.equal(signal.warehouses.GPT.pickedCases, 2);
  assert.equal(signal.warehouses.GPT.sourceObservedAt, refreshedAt.toISOString()); assert.equal(signal.sourceBusinessDate, options.businessDate); assert.equal(signal.sourceUpdatedAt, null);
  for (const product of f.products) f.demandObservations.push({ organizationId, productId: product.id, businessDate: new Date(options.businessDate), sourceObservedAt: now, sourceUpdatedAt: new Date('2026-11-10T07:01:00Z'), grossCases: 45, demandCases: 45, inboundCases: null, bottlesPerCase: 6, agencyCount: 2, summary: { byWarehouse: { GPT: 40, GRN: 5, UNASSIGNED: 0 }, sourceUpdatedAtOrigin: 'OPS_PRODUCTS_FOOTNOTE', sourceUpdatedAtStatus: 'KNOWN' } });
  const balance = (await getWarehouseBalanceSignals(organizationId, f.client, refreshedAt)).rows.find(item => item.itemCode === '2802B')!;
  assert.deepEqual(balance.warehouses.GPT, { demandCases: 40, inventoryCases: 37, balanceCases: -3, status: 'AVAILABLE' });
  assert.equal(await dcInventoryAlreadyObservedToday(organizationId, f.client, refreshedAt), true);
  assert.equal(JSON.stringify(f.products), productsBefore, 'refresh never enrolls sales-excluded 3150B or changes another product');
});

test('manual retrieval replay and out-of-order exports cannot duplicate facts or demote the latest check', async () => {
  const f = fixture(), freshAt = new Date('2026-11-10T14:00:00Z'), completedAt = new Date('2026-11-10T15:00:00Z');
  await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: downloadAt(csv(row({ gpt: '37' }), row({ code: '2806B' })), freshAt), refresh: true, db: f.client, now: freshAt });
  const accepted = JSON.stringify(f.observations), checked = JSON.stringify(f.checks);
  for (const observedAt of [freshAt, new Date('2026-11-10T13:30:00Z')]) {
    const result = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: downloadAt(csv(row({ gpt: '999' }), row({ code: '2806B' })), observedAt), refresh: true, db: f.client, now: completedAt });
    assert.equal(result.reused, 4); assert.equal(result.available, 0);
    assert.equal(JSON.stringify(f.observations), accepted); assert.equal(JSON.stringify(f.checks), checked);
  }
  // A missing/older check cannot let a delayed export append behind an accepted fact.
  f.checks.length = 0;
  const delayed = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), refresh: true, db: f.client, now: completedAt });
  assert.equal(delayed.reused, 4); assert.equal(f.checks.length, 0); assert.equal(JSON.stringify(f.observations), accepted);
});

test('failed, malformed, stale and misdated manual exports preserve accepted inventory and withhold current balances', async () => {
  const later = new Date('2026-11-10T14:00:00Z');
  const attempts: DcInventoryDownload[] = [
    { status: 'failed', observedAt: later.toISOString(), reason: 'upstream-unavailable' },
    downloadAt(csv(row()).replace('Brand_Code', 'Unknown'), later),
    downloadAt(csv(row({ date: '11/09/2026' }), row({ code: '2806B', date: '11/09/2026' })), later),
    { ...downloadAt(csv(row()), later), reportDate: '2026-11-09' },
    downloadAt(csv(row()), new Date('2026-11-10T15:00:00Z')),
  ];
  for (const attempt of attempts) {
    const f = fixture(); await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
    const before = JSON.stringify(f.observations);
    const result = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: attempt, refresh: true, db: f.client, now: later });
    assert.equal(result.available, 0); assert.equal(result.failed + result.unavailable, 4); assert.equal(JSON.stringify(f.observations), before);
    const signal = (await getDcInventorySignals(organizationId, f.client, later)).rows.find(item => item.itemCode === '3150B')!;
    assert.equal(signal.byWarehouse.GPT, 10); assert.equal(signal.retained, true); assert.equal(signal.warehouses.GPT.sourceObservedAt, now.toISOString());
    assert.equal(warehouseBalanceFor(demand(), signal, options.businessDate).warehouses.GPT.balanceCases, null);
  }
});

test('manual refresh updates valid warehouses independently and retains unknown or missing pairs without zero filling', async () => {
  const f = fixture(), later = new Date('2026-11-10T14:00:00Z');
  await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  const before = JSON.stringify(f.observations);
  const result = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: downloadAt(csv(row({ gpt: '', grn: '21', grnPicked: '1' })), later), refresh: true, db: f.client, now: later });
  assert.equal(result.available, 1); assert.equal(result.unavailable, 3); assert.equal(f.observations.length, 5);
  assert.equal(JSON.stringify(f.observations.slice(0, 4)), before);
  const signals = (await getDcInventorySignals(organizationId, f.client, later)).rows, product = signals.find(item => item.itemCode === '3150B')!, missing = signals.find(item => item.itemCode === '2806B')!;
  assert.equal(product.byWarehouse.GPT, 10); assert.equal(product.warehouses.GPT.reason, 'INVALID_QUANTITY'); assert.equal(product.warehouses.GPT.retained, true);
  assert.equal(product.byWarehouse.GRN, 22); assert.equal(product.warehouses.GRN.sourceObservedAt, later.toISOString()); assert.equal(product.warehouses.GRN.retained, false);
  const balance = warehouseBalanceFor(demand(), product, options.businessDate);
  assert.equal(balance.warehouses.GPT.balanceCases, null); assert.equal(balance.warehouses.GRN.balanceCases, 2);
  assert.equal(missing.warehouses.GPT.reason, 'MISSING_PRODUCT'); assert.equal(missing.warehouses.GPT.retained, true); assert.equal(missing.warehouses.GPT.sourceObservedAt, now.toISOString());
});

test('manual inventory appends retain tenant, vendor, business-date and sales-exclusion boundaries', async () => {
  const later = new Date('2026-11-10T14:00:00Z'), f = fixture();
  await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), db: f.client, now });
  const before = JSON.stringify(f.observations), products = JSON.stringify(f.products);
  const foreign = await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: downloadAt(csv(row({ vendor: 'FOREIGN' }), row({ code: 'UNRELATED' })), later), refresh: true, db: f.client, now: later });
  assert.equal(foreign.available, 0); assert.equal(foreign.unavailable, 4); assert.equal(JSON.stringify(f.observations), before); assert.equal(JSON.stringify(f.products), products);
  const revoked = fixture({ revoke: true });
  assert.equal((await ingestDcInventory({ organizationId, businessDate: options.businessDate, download: download(), refresh: true, db: revoked.client, now })).results.length, 0);
  assert.equal(revoked.observations.length, 0); assert.equal(revoked.checks.length, 0);
  await assert.rejects(() => ingestDcInventory({ organizationId: 'outside', businessDate: options.businessDate, download: download(), refresh: true, db: f.client, now }));
  await assert.rejects(() => ingestDcInventory({ organizationId, businessDate: '2026-11-11', download: download(), refresh: true, db: f.client, now }));
  assert.equal(JSON.stringify(f.observations), before);
});

test('intraday migration installs timestamped uniqueness before removing only the old daily observation index', () => {
  const sql = readFileSync(new URL('../prisma/migrations/20261110030000_dc_inventory_intraday_observations/migration.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX "dc_inventory_tenant_product_location_day_observed_key" ON "CurrentDcInventoryObservation"\("organizationId","productId","locationCode","businessDate","sourceObservedAt"\)/);
  assert.ok(sql.indexOf('CREATE UNIQUE INDEX') < sql.indexOf('DROP INDEX "dc_inventory_tenant_product_location_day_key"'));
  assert.doesNotMatch(sql, /\b(?:DELETE|UPDATE|INSERT|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
  assert.doesNotMatch(sql, /CurrentDcInventoryCheck|FOREIGN KEY/);
});
