import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { calculateCurrentDemand, parseItemCoverageFootnotes, warehouseForAgency, type CurrentDemandDownload } from '../lib/productionForecasting/operationalSignals/demand';
import { getCurrentDemandHistory, getCurrentDemandSignals, ingestCurrentDemand } from '../lib/productionForecasting/operationalSignals/demandIngestion';

const agencyRow = (agency = '30221', minimum: unknown = 14, inventory: unknown = 0, group = 'MIN'): unknown[] => [agency, 1, agency, 'Agency', 'City', '43215', group, minimum, null, inventory, 100, 1, 2, false, '2026-11-02', '<b>PRIVATE RESTRICTION HTML</b>'];
function payload(rows: unknown[][] = [agencyRow()], overrides: Record<string, unknown> = {}) {
  return { data: rows, inProcess: false, productName: 'Configured product', statusCode: '70', detailCode: 'A3A BAIL', bpc: '6', cntMin: rows.filter(r => r[6] === 'MIN').length, cntManual: rows.filter(r => r[6] === 'MANUAL').length, cntRestricted: rows.filter(r => r[6] === 'RESTRICTED').length, R14Date: 'Oct 31', ...overrides };
}
function available(source = payload()) {
  const result = calculateCurrentDemand('PRODUCT', source);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error('Expected an available estimate.');
  return result;
}

test('agency MIN estimate reaches MIN and rounds each agency before aggregation', () => {
  const result = available(payload([agencyRow('30221', 14, 0), agencyRow('20221', 6, 0), agencyRow('40221', 5, 5), agencyRow('50221', 6, 7), agencyRow('10221', 1, 0), agencyRow('90221', 1, 0)]));
  assert.equal(result.grossCases, 6);
  assert.equal(result.demandCases, 6);
  assert.equal(result.inboundCases, null, 'no invented transit reconciliation');
  assert.deepEqual(result.byWarehouse, { GPT: 4, GRN: 1, UNASSIGNED: 1 });
  assert.equal(result.evidence.rows[0].grossCases, 3, 'owner-confirmed 14 bottles / C6');
  assert.equal(available(payload([agencyRow('30221', 1, 0), agencyRow('30222', 1, 0)])).grossCases, 2, 'rounding a combined gap would incorrectly give one');
  assert.equal(result.evidence.method, 'OVERNIGHT_AGENCY_MIN_ESTIMATE');
  assert.equal(JSON.stringify(result).includes('PRIVATE RESTRICTION'), false);
  assert.equal(JSON.stringify(result).includes('R14Date'), false, 'sales-date metadata is not an inventory timestamp');
});

test('only exact MIN coverage contributes; unknown/A3A agency prefix stays unassigned', () => {
  const result = available(payload([agencyRow('30221', 6, 0, 'RESTRICTED'), agencyRow('30222', 6, 0, 'MANUAL'), agencyRow('A3A1', 6, 0)]));
  assert.equal(result.grossCases, 1);
  assert.equal(result.agencyCount, 1);
  assert.deepEqual(result.byWarehouse, { GPT: 0, GRN: 0, UNASSIGNED: 1 });
  for (const [prefix, expected] of [['1', 'GPT'], ['2', 'GRN'], ['3', 'GPT'], ['4', 'GRN'], ['5', 'GPT'], ['9', 'UNASSIGNED'], ['A3A', 'UNASSIGNED']]) assert.equal(warehouseForAgency(prefix + '0001'), expected);
});

test('verified empty coverage is zero; missing or truncated coverage is unavailable', () => {
  assert.equal(available(payload([])).demandCases, 0);
  for (const source of [undefined, {}, payload([], { data: undefined }), payload([agencyRow()], { cntMin: 2 }), payload([agencyRow()], { cntMin: 0, cntRestricted: 1 }), payload([agencyRow().slice(0, 15)])]) assert.equal(calculateCurrentDemand('PRODUCT', source).status, 'unavailable');
});

test('coverage-edit request inProcess flag does not alter a complete inventory estimate', () => {
  for (const inProcess of [true, false, undefined]) {
    const result = available(payload([agencyRow()], { inProcess }));
    assert.equal(result.demandCases, 3);
    assert.equal(result.agencyCount, 1);
  }
});

test('null, malformed and negative source inputs never become a numeric estimate', () => {
  for (const [minimum, inventory, reason] of [[null, 0, 'MISSING_QUANTITY'], [6, null, 'MISSING_QUANTITY'], [6, -11, 'NEGATIVE_INVENTORY'], [-1, 0, 'INVALID_QUANTITY'], [6, 'bad', 'INVALID_QUANTITY']] as const) {
    const result = calculateCurrentDemand('PRODUCT', payload([agencyRow('30221', minimum, inventory)]));
    assert.equal(result.status, 'unavailable');
    if (result.status === 'unavailable') assert.equal(result.reason, reason);
    if (inventory === -11) assert.equal(result.evidence.rows[0].inventoryBottles, -11, 'preserve the source anomaly');
    assert.equal('demandCases' in result, false);
  }
  for (const bpc of ['', null, '0', '-1', 'C6', '6.5']) assert.equal(calculateCurrentDemand('PRODUCT', payload([agencyRow()], { bpc })).status, 'unavailable');
});

test('identical duplicate agencies collapse and conflicting duplicates fail the product', () => {
  const row = agencyRow();
  const result = available(payload([row, [...row]]));
  assert.equal(result.grossCases, 3);
  assert.equal(result.evidence.duplicateRows, 1);
  assert.equal(result.agencyCount, 1);
  const conflict = calculateCurrentDemand('PRODUCT', payload([row, agencyRow('30221', 14, 2)]));
  assert.equal(conflict.status, 'unavailable');
  if (conflict.status === 'unavailable') assert.equal(conflict.reason, 'CONFLICTING_AGENCY_ROWS');
  const wrongIdentity = agencyRow(); wrongIdentity[2] = 'OTHER';
  assert.equal(calculateCurrentDemand('PRODUCT', payload([wrongIdentity])).status, 'unavailable');
});

test('A3A Bailment remains eligible; distillery-only and status 30 source metadata are rejected', () => {
  assert.equal(available().grossCases, 3);
  for (const overrides of [{ detailCode: 'A3A DIST' }, { detailCode: 'A-3A DISTILLERY ONLY' }, { statusCode: '30' }]) {
    const result = calculateCurrentDemand('PRODUCT', payload([agencyRow()], overrides));
    assert.equal(result.status, 'unavailable');
    if (result.status === 'unavailable') assert.equal(result.reason, 'SOURCE_INELIGIBLE');
  }
});

test('Item Coverage publication metadata uses Eastern time with strict calendars and explicit provenance', () => {
  const footnote = 'Item Coverage as of As of 3 Nov 2026 2:01 AM.';
  const parsed = parseItemCoverageFootnotes(['Unrelated footer', footnote], new Date('2026-11-03T13:00:00Z'));
  assert.equal(parsed.sourceUpdatedAt, '2026-11-03T07:01:00.000Z');
  assert.equal(parsed.sourceUpdatedAtOrigin, 'OPS_PRODUCTS_FOOTNOTE');
  assert.equal(parsed.sourceFootnote, footnote);
  assert.equal(parsed.sourceUpdatedAtStatus, 'KNOWN');
  assert.equal(parseItemCoverageFootnotes(['Item Coverage as of As of 3 Jul 2026 2:01 AM.'], new Date('2026-07-03T13:00:00Z')).sourceUpdatedAt, '2026-07-03T06:01:00.000Z');
  assert.equal(parseItemCoverageFootnotes([footnote, footnote], new Date('2026-11-03T13:00:00Z')).sourceUpdatedAt, parsed.sourceUpdatedAt);
  assert.equal(parseItemCoverageFootnotes([], new Date()).sourceUpdatedAt, null);
  const future = parseItemCoverageFootnotes([footnote], new Date('2026-11-03T07:00:00Z'));
  assert.equal(future.sourceUpdatedAt, null); assert.equal(future.sourceUpdatedAtStatus, 'FUTURE');
  for (const text of ['Item Coverage as of As of 30 Feb 2026 2:01 AM.', 'Item Coverage as of As of 8 Mar 2026 2:01 AM.', 'Item Coverage as of As of 3 Nov 2026 13:01 AM.', 'Item Coverage as of unknown']) {
    const result = parseItemCoverageFootnotes([text], new Date('2026-11-04T13:00:00Z'));
    assert.equal(result.sourceUpdatedAt, null); assert.equal(result.sourceUpdatedAtStatus, 'UNPARSEABLE');
    assert.equal(result.sourceFootnote, text, 'safe unparsed source text remains reviewable');
  }
  assert.equal(parseItemCoverageFootnotes(['Item Coverage as of As of 1 Nov 2026 1:30 AM.'], new Date('2026-11-03T13:00:00Z')).sourceUpdatedAtStatus, 'AMBIGUOUS');
  assert.equal(parseItemCoverageFootnotes([footnote, 'Item Coverage as of As of 2 Nov 2026 2:01 AM.'], new Date('2026-11-03T13:00:00Z')).sourceUpdatedAtStatus, 'CONFLICTING');
});

const organizationId = 'org_echo_spirits';
const now = new Date('2026-11-03T13:00:00Z');
function fixture({ forecastOnly = false, revokeBeforeWrite = false }: { forecastOnly?: boolean; revokeBeforeWrite?: boolean } = {}) {
  const products = ['A', 'B', ...(forecastOnly ? ['3150B'] : [])].map(code => ({ id: `product-${code}`, market: 'OH', externalItemCode: code, displayName: code, status: code === '3150B' ? 'EXCLUDED' : 'OWNED', active: true, discontinued: false }));
  let vendorActive = true;
  const vendorId = 'Z90399001';
  const observations: Array<Record<string, any>> = [];
  const checks: Array<Record<string, any>> = [];
  const scoped = (args: { where: Record<string, any> }) => assert.equal(args.where.organizationId, organizationId);
  const sameKey = (row: Record<string, any>, key: Record<string, any>) => row.organizationId === key.organizationId && row.productId === key.productId && String(row.businessDate) === String(key.businessDate);
  const tx: Record<string, any> = {
    $executeRaw: async () => { if (revokeBeforeWrite) vendorActive = false; return 1; },
    organization: { findFirst: async (args: any) => { assert.equal(args.where.id, organizationId); return { id: organizationId, enabledStates: ['OH'], settings: {}, timezone: 'America/New_York' }; } },
    organizationProduct: {
      findMany: async (args: any) => { scoped(args); return products.filter(product => (!args.where.externalItemCode || args.where.externalItemCode.in.includes(product.externalItemCode)) && (!args.where.status || args.where.status.in.includes(product.status))); },
    },
    organizationVendorIdentifier: { findMany: async (args: any) => { scoped(args); assert.equal(args.where.market, 'OH'); assert.equal(args.where.active, true); return vendorActive ? [{ vendorId }] : []; } },
    ohlqAgencyInventoryCurrent: { findMany: async (args: any) => { scoped(args); return []; } },
    ohlqTenantInventoryImportStatus: { findFirst: async (args: any) => { scoped(args); assert.equal(args.where.status, 'COMPLETED'); return { diagnostics: { forecastBailmentProducts: products.map(product => ({ itemCode: product.externalItemCode, itemName: product.displayName, vendorId })) } }; } },
    ohlqBrandMasterItem: { findMany: async () => [] },
    currentDemandObservation: {
      findUnique: async ({ where }: any) => observations.find(row => sameKey(row, where.organizationId_productId_businessDate)) ?? null,
      create: async ({ data }: any) => { assert.equal(data.organizationId, organizationId); const row = { ...data, id: `observation-${observations.length}` }; observations.push(row); return { id: row.id }; },
      findMany: async (args: any) => {
        scoped(args);
        assert.equal(args.select.evidence, undefined, 'dashboard/history must not load per-agency raw evidence');
        const rows = observations.filter(row => typeof args.where.productId === 'string' ? row.productId === args.where.productId : args.where.productId.in.includes(row.productId)).sort((a, b) => b.businessDate.getTime() - a.businessDate.getTime());
        return args.distinct ? rows.filter((row, i) => rows.findIndex(other => other.productId === row.productId) === i) : rows.slice(0, args.take);
      },
    },
    currentDemandCheck: {
      upsert: async ({ where, create, update }: any) => { const row = checks.find(r => sameKey(r, where.organizationId_productId_businessDate)); if (row) Object.assign(row, update); else checks.push(create); },
      findMany: async (args: any) => { scoped(args); const rows = checks.filter(row => args.where.productId.in.includes(row.productId)).sort((a, b) => b.businessDate.getTime() - a.businessDate.getTime()); return rows.filter((row, i) => rows.findIndex(other => other.productId === row.productId) === i); },
    },
  };
  const client = { ...tx, $transaction: async (callback: (db: unknown) => Promise<unknown>) => callback(tx) } as unknown as PrismaClient;
  return { client, observations, checks, products };
}
const download = (b: unknown = payload()): CurrentDemandDownload => ({ products: [
  { itemCode: 'A', status: 'ok', observedAt: now.toISOString(), payload: payload() },
  { itemCode: 'B', status: 'ok', observedAt: now.toISOString(), payload: b },
  { itemCode: 'UNCONFIGURED', status: 'ok', observedAt: now.toISOString(), payload: payload() },
] });

test('daily ingestion is tenant/product scoped, idempotent, and preserves signed unavailable evidence', async () => {
  const f = fixture();
  const result = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: download(payload([agencyRow('30221', 14, -11)])), db: f.client, now });
  assert.equal(result.available, 1); assert.equal(result.unavailable, 1);
  assert.equal(f.observations.length, 1);
  assert.equal(f.observations[0].grossCases, 3);
  assert.equal(f.observations[0].demandCases, 3);
  assert.equal(f.observations[0].inboundCases, null);
  assert.equal(f.observations[0].sourceUpdatedAt, null);
  assert.equal(f.checks.find(c => c.productId === 'product-B')?.evidence.rows[0].inventoryBottles, -11);
  const before = JSON.stringify(f.observations);
  const replay = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: { products: [{ itemCode: 'A', status: 'failed', observedAt: now.toISOString(), reason: 'upstream-unavailable' }] }, db: f.client, now });
  assert.equal(replay.reused, 1);
  assert.equal(JSON.stringify(f.observations), before, 'failed replay cannot replace a saved good observation');
  assert.equal(f.checks.find(c => c.productId === 'product-A')?.status, 'AVAILABLE');
});

test('forecast-only excluded item receives Current Demand without becoming a sales product', async () => {
  const f = fixture({ forecastOnly: true }), before = JSON.stringify(f.products);
  const input = download();
  input.products.push({ itemCode: '3150B', status: 'ok', observedAt: now.toISOString(), payload: payload() });
  const result = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: input, db: f.client, now });
  assert.equal(result.available, 3);
  assert.equal(f.observations.find(row => row.itemCode === '3150B')?.demandCases, 3);
  assert.equal((await getCurrentDemandSignals(organizationId, f.client, now)).rows.find(row => row.itemCode === '3150B')?.demandCases, 3);
  assert.equal((await getCurrentDemandHistory(organizationId, 'product-3150B', f.client)).length, 1);
  assert.equal(JSON.stringify(f.products), before, 'ingestion must preserve EXCLUDED sales status and product configuration');
});

test('Current Demand rechecks the active vendor inside the persistence transaction', async () => {
  const f = fixture({ forecastOnly: true, revokeBeforeWrite: true });
  const input = download();
  input.products.push({ itemCode: '3150B', status: 'ok', observedAt: now.toISOString(), payload: payload() });
  const result = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: input, db: f.client, now });
  assert.equal(result.unavailable, 3);
  assert.ok(result.results.every(row => row.reason === 'PRODUCT_INELIGIBLE'));
  assert.equal(f.observations.length, 0);
  assert.equal(f.checks.length, 0);
});

test('a failed product does not suppress another product and later failures retain yesterday facts', async () => {
  const f = fixture();
  const input = download(); input.products[0] = { itemCode: 'A', status: 'failed', observedAt: now.toISOString(), reason: 'upstream-authentication' };
  const result = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: input, db: f.client, now });
  assert.equal(result.failed, 1); assert.equal(result.available, 1);
  const before = JSON.stringify(f.observations);
  await ingestCurrentDemand({ organizationId, businessDate: '2026-11-04', download: { products: [] }, db: f.client, now: new Date('2026-11-04T13:00:00Z') });
  assert.equal(JSON.stringify(f.observations), before);
  assert.equal(f.checks.filter(c => c.status === 'FAILED').length, 3);
  const signals = await getCurrentDemandSignals(organizationId, f.client, new Date('2026-11-04T13:00:00Z'));
  const retained = signals.rows.find(row => row.itemCode === 'B')!;
  assert.equal(retained.demandCases, 3); assert.equal(retained.status, 'FAILED');
  assert.equal(retained.stale, true); assert.equal(retained.retained, true);
  assert.deepEqual(retained.byWarehouse, { GPT: 3, GRN: 0, UNASSIGNED: 0 });
  assert.equal(signals.rows.find(row => row.itemCode === 'A')!.demandCases, null);
  const history = await getCurrentDemandHistory(organizationId, 'product-B', f.client);
  assert.equal(history.length, 1); assert.equal(history[0].demandCases, 3);
  assert.deepEqual(await getCurrentDemandHistory(organizationId, 'foreign-product', f.client), []);
});

test('a delayed publication retains the prior fact, permits a fresh same-day retry, and future metadata stays unknown', async () => {
  const f = fixture();
  const yesterday = new Date('2026-11-02T13:00:00Z');
  const oldFootnote = 'Item Coverage as of As of 2 Nov 2026 2:01 AM.';
  const prior = download();
  prior.products = prior.products.map(product => ({ ...product, observedAt: yesterday.toISOString(), ...parseItemCoverageFootnotes([oldFootnote], yesterday) }));
  await ingestCurrentDemand({ organizationId, businessDate: '2026-11-02', download: prior, db: f.client, now: yesterday });
  const input = download();
  input.products[0] = { itemCode: 'A', status: 'ok', observedAt: now.toISOString(), payload: payload(), ...parseItemCoverageFootnotes([oldFootnote], now) };
  const futureFootnote = 'Item Coverage as of As of 4 Nov 2026 2:01 AM.';
  input.products[1] = { itemCode: 'B', status: 'ok', observedAt: now.toISOString(), payload: payload(), ...parseItemCoverageFootnotes([futureFootnote], now) };
  const result = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: input, db: f.client, now });
  assert.equal(result.unavailable, 1); assert.equal(result.available, 1);
  const signals = await getCurrentDemandSignals(organizationId, f.client, now);
  const stale = signals.rows.find(row => row.itemCode === 'A')!;
  assert.equal(stale.businessDate, '2026-11-02'); assert.equal(stale.sourceObservedAt, yesterday.toISOString());
  assert.equal(stale.sourceUpdatedAt, '2026-11-02T07:01:00.000Z');
  assert.equal(stale.sourceUpdatedAtOrigin, 'OPS_PRODUCTS_FOOTNOTE');
  assert.equal(stale.stale, true); assert.equal(stale.sourceFreshness, 'STALE');
  assert.equal(stale.observedAgeMinutes, 1440); assert.equal(stale.sourceAgeMinutes, 1799);
  assert.equal(stale.status, 'UNAVAILABLE'); assert.equal(stale.reason, 'STALE_SOURCE'); assert.equal(stale.retained, true);
  assert.equal(f.observations.filter(row => row.productId === 'product-A').length, 1, 'stale source cannot consume the immutable daily success slot');
  const attempt = f.checks.find(row => row.productId === 'product-A' && row.businessDate.toISOString().slice(0, 10) === '2026-11-03')!;
  assert.equal(attempt.evidence.sourceUpdatedAt, '2026-11-02T07:01:00.000Z');
  assert.equal(attempt.evidence.sourceFootnote, oldFootnote);
  const unknown = signals.rows.find(row => row.itemCode === 'B')!;
  assert.equal(unknown.sourceUpdatedAt, null); assert.equal(unknown.sourceUpdatedAtStatus, 'FUTURE');
  assert.equal(unknown.sourceFreshness, 'UNKNOWN'); assert.equal(unknown.sourceAgeMinutes, null);
  assert.equal(f.observations.find(row => row.productId === 'product-B' && row.businessDate.toISOString().slice(0, 10) === '2026-11-03')!.evidence.sourceFootnote, futureFootnote);
  const history = await getCurrentDemandHistory(organizationId, 'product-A', f.client);
  assert.equal(history[0].sourceUpdatedAt, stale.sourceUpdatedAt);
  assert.equal(history[0].sourceUpdatedAtOrigin, 'OPS_PRODUCTS_FOOTNOTE');
  const fresh = download();
  fresh.products[0] = { itemCode: 'A', status: 'ok', observedAt: now.toISOString(), payload: payload(), ...parseItemCoverageFootnotes(['Item Coverage as of As of 3 Nov 2026 2:01 AM.'], now) };
  const retry = await ingestCurrentDemand({ organizationId, businessDate: '2026-11-03', download: fresh, db: f.client, now });
  assert.equal(retry.available, 1); assert.equal(retry.reused, 1);
  const recovered = (await getCurrentDemandSignals(organizationId, f.client, now)).rows.find(row => row.itemCode === 'A')!;
  assert.equal(recovered.businessDate, '2026-11-03'); assert.equal(recovered.status, 'AVAILABLE');
  assert.equal(recovered.stale, false); assert.equal(recovered.retained, false);
  assert.equal(recovered.sourceFreshness, 'CURRENT'); assert.equal(recovered.demandCases, 3);
});
