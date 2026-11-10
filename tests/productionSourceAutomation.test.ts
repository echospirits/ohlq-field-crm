import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { normalizeNativeOhio, type OhioItemContext } from '../lib/productionForecasting/ohio';
import { parseProductionSource, type NormalizedRow } from '../lib/productionForecasting/import';
import { demandIdentity, mergeCoverage, reconcileDemandRows, scopeIdentity, type StoredDemandVersion } from '../lib/productionForecasting/reconciliation';
import { ohioSourceConfiguration, syncProductionSources } from '../lib/productionForecasting/sourceWorkflow';
import { valuesKnownAt } from '../lib/productionForecasting/engine';
import { OHLQ_BAILMENT_INVOICE_REPORT, validateOhlqPartnerDcExport } from '../lib/ohlqAnnualSalesReport';

const context: OhioItemContext = { included: new Set(['RUM', 'DIST', 'ZERO']), bailment: new Set(['RUM']), distilleryOnly: new Set(['DIST']) };
const header = 'Invoice_Date,Invoice_Number,PO_Number,Transfer_Order_Number,Agency,Transfer_Order_Ship_Date,Brand,DC_Name,Cases,Odd_Bottles,Cases_Bottles';
const sample = header + '\n10/20/2026,invoice-1,po-1,transfer-1,1,10/21/2026,RUM,GPT,2,3,C6\n10/22/2026,invoice-2,po-2,,90399,,RUM,,1,0,C12\n10/22/2026,invoice-3,po-3,,,,RUM,,1,0,C12\n10/28/2026,today,po-4,transfer-4,1,10/28/2026,RUM,GPT,10,0,C6\n10/20/2026,dist,po-5,transfer-5,1,10/21/2026,DIST,GPT,100,0,C6';
const window = { start: '2019-01-01', end: '2026-10-27' };
const options = { organizationId: 'org', market: 'OH', source: 'BAILMENT_PO_INVOICE' as const, ...window, observedOn: '2026-10-28', complete: true };
test('DC pagination cannot silently truncate guidance or turn a filtered table into a complete export', () => {
  validateOhlqPartnerDcExport('Code,Product Name\nRUM,Rum\nGIN,Gin', 'Showing 1 to 1 of 2 entries');
  assert.throws(() => validateOhlqPartnerDcExport('Code,Product Name\nRUM,Rum', 'Showing 1 to 1 of 2 entries'), /row count/);
  assert.throws(() => validateOhlqPartnerDcExport('Code,Product Name\nRUM,Rum', 'Showing 1 to 1 of 1 entries (filtered from 33 total entries)'), /unfiltered/);
});
test('full native report maps approved direct invoices, keeps item exclusions, case packs, complete scopes and date clipping', () => {
  const native = normalizeNativeOhio(sample, options.source, context, { ...window, fullPortfolio: true, directInvoices: 'invoice-date' })!;
  const result = parseProductionSource(native.csv, options);
  assert.equal(result.rows.find(r => r.date === '2026-10-21' && r.itemCode === 'RUM')?.cases, 2.5);
  assert.equal(result.rows.find(r => r.locationCode === 'DIRECT:90399')?.status, 'POSTED');
  assert.equal(result.rows.find(r => r.locationCode === 'DIRECT:UNSPECIFIED')?.locationName, 'Unspecified fulfillment');
  assert.equal(native.directRows, 2); assert.equal(native.outsideWindowRows, 1);
  assert.equal(result.scopes.length, 12); assert.equal(result.scopes.filter(s => s.itemCode === 'ZERO').length, 4);
  assert.equal(result.rows.find(r => r.itemCode === 'DIST' && r.cases > 0)?.classification, 'A3A_DIST');
  assert.equal(result.rows.some(r => r.date === '2026-10-28'), false);
});
test('unconfigured direct policy rejects ambiguity; shipment-only is an explicit alternative', () => {
  assert.throws(() => normalizeNativeOhio(sample, options.source, context, { ...window, fullPortfolio: true }), /Configure how direct invoices/);
  const native = normalizeNativeOhio(sample, options.source, context, { ...window, fullPortfolio: true, directInvoices: 'shipment-only' })!;
  assert.equal(native.unshippedRows, 2); assert.equal(native.directRows, 0);
  assert.equal(parseProductionSource(native.csv, options).scopes.some(s => s.locationCode.startsWith('DIRECT')), false);
  assert.deepEqual(ohioSourceConfiguration({}), { historyStart: null, directInvoices: null });
});
const row: NormalizedRow = { itemCode: 'RUM', locationCode: 'GPT', locationName: 'Groveport', classification: 'BAILMENT', sourceLineId: 'invoice', date: '2026-10-20', availableOn: '2026-10-20', cases: 2, status: 'SHIPPED', minimum: null, maximum: null };
const old: StoredDemandVersion = { ...row, id: 'old', versionAt: '2026-10-21T12:00:00Z' };
test('reconciliation saves changes, late additions and removals without doubling demand or rewriting earlier backtests', () => {
  const coverage = new Map([[scopeIdentity(row), '2026-10-27']]);
  assert.equal(reconcileDemandRows([row], [old], coverage, '2026-10-28').writes.length, 0);
  const changed = reconcileDemandRows([{ ...row, cases: 3 }], [old], coverage, '2026-10-28');
  assert.equal(changed.changed, 1); assert.equal(changed.writes[0].row.availableOn, '2026-10-28');
  const late = reconcileDemandRows([{ ...row, sourceLineId: 'late' }], [], coverage, '2026-10-28');
  assert.equal(late.writes[0].row.availableOn, '2026-10-28');
  const removed = reconcileDemandRows([], [old], coverage, '2026-10-28');
  assert.equal(removed.removed, 1); assert.equal(removed.writes[0].row.cases, 0);
  const series = { market: 'OH', itemCode: 'RUM', location: { code: 'GPT', name: 'Groveport' }, coverage: [{ start: '2026-10-20', end: '2026-10-29' }], observations: [{ ...old, sourceLineId: demandIdentity(old.sourceLineId, old.date) }, { ...changed.writes[0].row, versionAt: '2026-10-28T12:00:00Z' }] };
  assert.equal(valuesKnownAt(series, '2026-10-27').get('2026-10-20'), 2);
  assert.equal(valuesKnownAt(series, '2026-10-28').get('2026-10-20'), 3);
  series.observations.push({ ...removed.writes[0].row, versionAt: '2026-10-29T12:00:00Z' });
  assert.equal(valuesKnownAt(series, '2026-10-29').get('2026-10-20'), 0);
  const excluded = { ...series, observations: [series.observations[0], { ...changed.writes[0].row, classification: 'A3A_DIST' as const, versionAt: '2026-10-28T12:00:00Z' }] };
  assert.equal(valuesKnownAt(excluded, '2026-10-28').get('2026-10-20'), 0);
});
test('date corrections reverse the old day; suspected truncation rejects atomically; coverage stays bounded', () => {
  const result = reconcileDemandRows([{ ...row, date: '2026-10-22' }], [old], new Map(), '2026-10-28');
  assert.equal(result.removed, 1); assert.equal(result.added, 1); assert.equal(result.writes.find(w => w.removed)?.row.date, old.date);
  const many = Array.from({ length: 25 }, (_, i) => ({ ...old, id: String(i), sourceLineId: String(i) }));
  assert.throws(() => reconcileDemandRows([], many, new Map(), '2026-10-28'), /lost too many/);
  assert.deepEqual(mergeCoverage([{ start: '2026-01-01', end: '2026-10-27' }, { start: '2026-01-01', end: '2026-10-28' }, { start: '2026-10-29', end: '2026-10-30' }]), [{ start: '2026-01-01', end: '2026-10-30' }]);
});

test('scheduled Echo sources fail independently, skip outside credentials, refresh, and never log provider payloads', async () => {
  const organizations = ['org_echo_spirits', 'outside'].map(id => ({ id, timezone: 'America/New_York', settings: { productionForecasting: { ohio: { historyStart: '2019-01-01', directInvoices: 'invoice-date' } } } }));
  const called: string[] = [], messages: string[] = [], failures: unknown[] = [];
  const stages: string[] = [];
  let outcome: unknown;
  let query: unknown;
  const db = { organization: { findMany: async (args: unknown) => { query = args; return organizations; } }, productionSourceImport: { upsert: async (args: unknown) => { failures.push(args); } } } as unknown as PrismaClient;
  const download = (organization: string) => ({ csvBuffer: Buffer.from(organization), reportDate: '2026-10-28', filename: 'private.csv', outputPath: '/private.csv', runDate: '2026-10-28', sizeBytes: 1 });
  const services = {
    credentials: async (id: string) => { assert.equal(id, 'org_echo_spirits'); return { username: id, password: 'never-log' }; },
    bailment: async (o: { partnerCredentials?: { username: string }; fromDate: string }) => { called.push(`bailment:${o.partnerCredentials?.username}`); assert.equal(o.fromDate, '2019-01-01'); throw new Error('private-provider-payload'); },
    dc: async (o: { partnerCredentials?: { username: string } }) => { called.push(`dc:${o.partnerCredentials?.username}`); return download(o.partnerCredentials!.username); },
    importCsv: async (_csv: string, o: { source: string; organizationId: string; end: string }) => { called.push(`import:${o.organizationId}:${o.source}`); if (o.source === 'BAILMENT_PO_INVOICE') assert.equal(o.end, '2026-10-27'); return { id: 'batch', replay: false, rowCount: 1, excludedRows: 0 }; },
    refresh: async (id: string) => { called.push(`refresh:${id}`); return { id: 'run', replay: false, products: 1 }; },
  } as unknown as NonNullable<Parameters<typeof syncProductionSources>[0]>['services'];
  await assert.rejects(() => syncProductionSources({ db, services, now: new Date('2026-10-28T16:00:00Z'), logger: { log: m => messages.push(m), error: m => messages.push(m) }, onStage: async stage => { stages.push(stage); }, onResult: result => { outcome = result; } }), /org_echo_spirits:BAILMENT_PO_INVOICE/);
  assert.ok(called.includes('import:org_echo_spirits:DISTRIBUTION_CENTER')); assert.ok(called.includes('refresh:org_echo_spirits')); assert.ok(!called.some(call => call.includes('outside')));
  assert.equal(failures.length, 1); assert.doesNotMatch(JSON.stringify([messages, failures]), /never-log|private-provider-payload/);
  assert.deepEqual(stages, ['BAILMENT', 'GUIDANCE', 'FORECAST']);
  assert.deepEqual(outcome, { configuredOrganizations: 1, importedSources: 1, refreshedForecasts: 1, failedSources: ['BAILMENT_PO_INVOICE'] }, 'a failed source still reports persisted independent progress before rejecting');
  assert.match(JSON.stringify(query), /PRODUCTION_FORECASTING/); assert.match(JSON.stringify(query), /SUSPENDED/); assert.match(JSON.stringify(query), /ohlqCredentials/);
});
test('automation reuses isolated OHLQ job, permits focused dispatch and keeps private exports out of artifacts', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ohlq-annual-sales.yml', import.meta.url), 'utf8');
  const step = workflow.split('- name: Download and import production forecasting sources')[1].split('- name:')[0];
  assert.match(step, /!cancelled\(\)/); assert.match(step, /steps.required_secrets.outcome == 'success'/); assert.match(step, /credential_repair.outcome != 'failure'/);
  assert.doesNotMatch(step, /steps.(sales_import|brand_master|account_master).outcome/);
  assert.match(workflow, /productionSourcesOnly:/); assert.match(step, /sync:production-sources.*--apply/);
  assert.equal(OHLQ_BAILMENT_INVOICE_REPORT.reportId, 'bdf38254-b332-4d12-b689-1113a2644a40');
});


test('only an explicit source-workflow manual mode opts operations into same-day warehouse re-observation', async () => {
  const forwarded: Array<boolean | undefined> = [];
  const db = { organization: { findMany: async () => [] } } as unknown as PrismaClient;
  const services = {
    credentials: async () => null,
    bailment: async () => { throw Error('No source organization'); },
    dc: async () => { throw Error('No source organization'); },
    importCsv: async () => { throw Error('No source organization'); },
    refresh: async () => { throw Error('No source organization'); },
    operations: async (options?: { refreshInventory?: boolean }) => { forwarded.push(options?.refreshInventory); return { failed: 0 }; },
  };
  await syncProductionSources({ db, services });
  await syncProductionSources({ db, services, refreshInventory: true });
  assert.deepEqual(forwarded, [false, true]);
});
