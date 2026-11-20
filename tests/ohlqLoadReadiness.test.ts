import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkOhlqLoadReadiness, type OhlqLoadReadinessDb } from '../lib/ohlqLoadReadiness';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';
import { BAILMENT_REPORTING_REPORT_ID } from '../lib/ohlqBailmentReporting';
import { BAILMENT_REPORTING_SCHEMA_VERSION } from '../lib/ohlqBailmentReportingParser';
import { AGENCY_INTELLIGENCE_RULES_VERSION, AGENCY_INTELLIGENCE_SCORING_VERSION } from '../lib/agencyIntelligenceConfig';
import { AGENCY_MARKET_SCORING_VERSION } from '../lib/agencyMarketIntelligence';
import { ASSESSMENT_VERSION, CALIBRATION_VERSION } from '../lib/wholesaleAssessment';
import { MODEL_VERSION, forecastConfiguration } from '../lib/productionForecasting/model';
import { DC_INVENTORY_ADAPTER_VERSION, DC_INVENTORY_SOURCE } from '../lib/productionForecasting/operationalSignals/dcInventory';
import { CURRENT_DEMAND_CALCULATION_VERSION, CURRENT_DEMAND_SOURCE } from '../lib/productionForecasting/operationalSignals/demand';

type Row = Record<string, unknown>;
const d = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
const input = { reportDates: ['2026-11-17', '2026-11-18'], observationDate: '2026-11-19' };
const org = ECHO_ORGANIZATION_ID;
const at = d('2026-11-19T12:00:00Z');
const scored = d('2026-11-19T12:30:00Z');
const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value);
const comparable = (value: unknown) => value instanceof Date ? value.getTime() : value as string | number;

// A small read-only Prisma-shaped store. Applying predicates (rather than
// returning the same success for every query) exercises dates and enrollment.
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some(item => matches(row, item));
    if (key === 'AND') return (condition as Row[]).every(item => matches(row, item));
    const value = row[key];
    if (!isObject(condition)) return comparable(value) === comparable(condition);
    if ('in' in condition) return (condition.in as unknown[]).some(item => comparable(item) === comparable(value));
    if ('notIn' in condition) return !(condition.notIn as unknown[]).some(item => comparable(item) === comparable(value));
    if ('has' in condition) return (value as unknown[]).includes(condition.has);
    if ('isNot' in condition) return value !== condition.isNot;
    if ('some' in condition) return Array.isArray(value) && value.some(item => matches(item as Row, condition.some as Row));
    if (['gte', 'lte', 'gt', 'lt'].some(operator => operator in condition)) return Object.entries(condition).every(([operator, rhs]) =>
      operator === 'gte' ? comparable(value) >= comparable(rhs) : operator === 'lte' ? comparable(value) <= comparable(rhs) : operator === 'gt' ? comparable(value) > comparable(rhs) : comparable(value) < comparable(rhs));
    // Unique compound keys have no stored wrapper field.
    return matches(isObject(value) ? value : row, condition);
  });
}

function fixture() {
  const tables: Record<string, Row[]> = {};
  const calls: { table: string; method: string; args: Row }[] = [];
  const receipt = (dataSource: string, reportDate: string, count = 1): Row => ({ id: `${dataSource}:${reportDate}`, dataSource, reportDate: d(reportDate), status: 'COMPLETED', rowCount: count, parsedRows: count, skippedRows: 0, completedAt: at, updatedAt: at });
  tables.ohlqReportImportStatus = [
    ...input.reportDates.flatMap(reportDate => ['ANNUAL_SALES_SUMMARY', 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE'].map(source => receipt(source, reportDate))),
    receipt('ACCOUNT_MASTER', input.observationDate), receipt('BRAND_MASTER', input.observationDate),
  ];
  tables.ohlqAnnualSalesRow = input.reportDates.map(reportDate => ({ reportDate: d(reportDate) }));
  tables.ohlqAnnualSalesByWholesaleRow = input.reportDates.map(reportDate => ({ reportDate: d(reportDate) }));
  const settings = { productionForecasting: { ohio: { historyStart: '2026-01-01', directInvoices: 'invoice-date' } } };
  const organization = { id: org, active: true, accountStatus: 'ACTIVE', enabledStates: ['OH'], settings, timezone: 'America/New_York', ohlqCredentials: { organizationId: org }, accountOverlays: [], features: ['AGENCY_INTELLIGENCE', 'WHOLESALE_OPPORTUNITIES', 'PRODUCTION_FORECASTING'].map(featureKey => ({ id: featureKey, enabled: true, featureKey })) };
  tables.organization = [organization];
  tables.agency = [{ id: 'agency-a', agencyId: '001' }, { id: 'ignored-agency', agencyId: null }];
  tables.wholesaleAccount = [{ id: 'account-a', isActive: true, mergedIntoId: null }];
  const catalog = { itemCode: '1000B', name: 'Example', category: 'RUM', productVolume: 750, wholesalePrice: 20, retailPrice: 25, solItemStatusCode: '70', updatedAt: at };
  tables.ohlqBrandMasterItem = [catalog];
  const decision = { id: 'product-a', organizationId: org, market: 'OH', externalItemCode: '1000B', displayName: 'Example', active: true, discontinued: false, status: 'OWNED', updatedAt: at };
  tables.organizationProduct = [decision];
  tables.organizationVendorIdentifier = [{ organizationId: org, market: 'OH', active: true, vendorId: 'vendor-a' }];
  tables.ohlqTenantInventoryImportStatus = [{ organizationId: org, reportDate: d(input.observationDate), status: 'COMPLETED', completedAt: at, updatedAt: at, rowCount: 1, parsedRows: 3, skippedRows: 2, diagnostics: {} }];
  const inventory = { organizationId: org, snapshotDate: d(input.observationDate), agencyNumber: '001', itemCode: '1000B', itemName: 'Example', vendorId: 'vendor-a', detailCodeDescription: 'A3A BAIL', status: 'Active' };
  tables.ohlqAgencyInventorySnapshot = [inventory];
  tables.ohlqAgencyInventoryCurrent = [inventory];
  tables.agencyIntelligenceSummary = [{ organizationId: org, agencyId: 'agency-a', asOfDate: d(input.observationDate), rulesVersion: AGENCY_INTELLIGENCE_RULES_VERSION, scoringVersion: AGENCY_INTELLIGENCE_SCORING_VERSION, updatedAt: scored, signalSnapshot: { products: [{ signals: { itemCode: '1000B' } }] } }];
  tables.agencyProductIntelligence = [{ organizationId: org, agencyId: 'agency-a', itemCode: '1000B', asOfDate: d(input.observationDate), rulesVersion: AGENCY_INTELLIGENCE_RULES_VERSION, scoringVersion: AGENCY_INTELLIGENCE_SCORING_VERSION, updatedAt: scored }];
  tables.agencyMarketProfile = [{ organizationId: org, agencyId: 'agency-a', asOfDate: d('2026-11-18'), scoringVersion: AGENCY_MARKET_SCORING_VERSION, updatedAt: scored }];
  tables.agencyProductMarketFit = [{ organizationId: org, agencyId: 'agency-a', itemCode: '1000B', asOfDate: d('2026-11-18'), scoringVersion: AGENCY_MARKET_SCORING_VERSION, updatedAt: scored }];
  const configurationId = createHash('sha256').update(JSON.stringify({ calibration: CALIBRATION_VERSION, decisions: [decision], catalog: [{ code: catalog.itemCode, name: catalog.name, category: catalog.category, size: catalog.productVolume, wholesale: catalog.wholesalePrice, retail: catalog.retailPrice, status: catalog.solItemStatusCode }] })).digest('hex').slice(0, 16);
  const run = { id: 'assessment-run', organizationId: org, fullSweep: true, status: 'COMPLETED', startedAt: scored, completedAt: scored, modelVersion: ASSESSMENT_VERSION, configurationId, asOfDate: d('2026-11-18'), expected: 1, evaluated: 1, persisted: 1, failed: 0, skipped: 0, sourceCoverage: { status: 'REPRESENTED_PERIOD_COMPLETE', from: '2026-11-17', through: '2026-11-18', representedDays: 2, completeDays: 2, missingDates: ['2026-09-01'] } };
  tables.wholesaleAssessmentRun = [run];
  tables.wholesaleAccountAssessment = [{ organizationId: org, wholesaleAccountId: 'account-a', wholesaleAccount: { mergedIntoId: null }, asOfDate: d('2026-11-18'), modelVersion: ASSESSMENT_VERSION, configurationId, assessmentStatus: 'READY', calculatedAt: scored, run }];
  tables.wholesaleSalesLedgerDay = input.reportDates.map(reportDate => ({ organizationId: org, reportDate: d(reportDate), sourceRows: 1, sourceRevision: `${at.toISOString()}:1` }));
  tables.productionSourceImport = [
    { id: 'bailment', organizationId: org, market: 'OH', source: 'BAILMENT_PO_INVOICE', status: 'COMPLETE', observedOn: d(input.observationDate), coverageStart: d('2026-01-01'), coverageEnd: d('2026-11-18'), importedAt: scored, summary: { completenessConfirmed: true, directInvoicePolicy: 'invoice-date', scopes: [] }, rowCount: 0, excludedRows: 0 },
    { id: 'dc', organizationId: org, market: 'OH', source: 'DISTRIBUTION_CENTER', status: 'COMPLETE', observedOn: d(input.observationDate), coverageStart: d(input.observationDate), coverageEnd: d(input.observationDate), importedAt: scored, summary: { completenessConfirmed: true }, rowCount: 0 },
  ];
  tables.ohlqBailmentReportingSnapshot = [{ id: 'native-report', organizationId: org, requestId: 'request-a', requestedAt: at, acquiredAt: scored, requestedFrom: d('2026-01-01'), requestedTo: d(input.observationDate), timezone: organization.timezone, reportIdentity: BAILMENT_REPORTING_REPORT_ID, parameterScope: { parameter: 'Vendor', values: 'all' }, schemaVersion: BAILMENT_REPORTING_SCHEMA_VERSION, rowCount: 2, createdAt: d('2026-11-17') }];
  tables.ohlqBailmentReportingLine = [1, 2].map(sourceLineNumber => ({ organizationId: org, snapshotId: 'native-report', sourceLineNumber }));
  tables.productionDemandObservation = [];
  tables.productionGuidanceObservation = [];
  const forecastProducts = [{ id: 'product-a', market: 'OH', code: '1000B', name: 'Example', demandExcluded: false }];
  const runKey = createHash('sha256').update(JSON.stringify({ today: input.observationDate, version: MODEL_VERSION, config: forecastConfiguration(settings), demandExclusions: [], products: forecastProducts, imports: ['bailment'], guidance: [] })).digest('hex');
  tables.productionForecastRun = [{ id: 'forecast-run', organizationId: org, runKey, generatedAt: at, modelVersion: MODEL_VERSION, horizonStart: d(input.observationDate) }];
  tables.productionForecastSnapshot = [{ organizationId: org, runId: 'forecast-run', productId: 'product-a', horizonStart: d(input.observationDate), horizonEnd: d('2026-12-18'), point: null }];
  tables.currentDemandObservation = [{ organizationId: org, productId: 'product-a', businessDate: d(input.observationDate), source: CURRENT_DEMAND_SOURCE, calculationVersion: CURRENT_DEMAND_CALCULATION_VERSION }];
  tables.currentDemandCheck = [];
  tables.currentDcInventoryObservation = ['GPT', 'GRN'].map(locationCode => ({ organizationId: org, productId: 'product-a', locationCode, businessDate: d(input.observationDate), sourceBusinessDate: d(input.observationDate), source: DC_INVENTORY_SOURCE, adapterVersion: DC_INVENTORY_ADAPTER_VERSION }));
  tables.currentDcInventoryCheck = [];
  const db = new Proxy({}, { get: (_, table: string) => new Proxy({}, { get: (_delegate, method: string) => async (args: Row = {}) => {
    assert.ok(['findMany', 'findUnique', 'findFirst', 'count'].includes(method), `Unexpected non-read call: ${table}.${method}`);
    calls.push({ table, method, args });
    let rows = (tables[table] ?? []).filter(row => matches(row, args.where as Row));
    const ordering = Array.isArray(args.orderBy) ? args.orderBy as Row[] : args.orderBy ? [args.orderBy as Row] : [];
    rows = [...rows].sort((a, b) => {
      for (const order of ordering) for (const [field, direction] of Object.entries(order)) {
        const delta = comparable(a[field]) < comparable(b[field]) ? -1 : comparable(a[field]) > comparable(b[field]) ? 1 : 0;
        if (delta) return direction === 'desc' ? -delta : delta;
      }
      return 0;
    });
    if (method === 'count') return rows.length;
    if (typeof args.take === 'number') rows = rows.slice(0, args.take);
    if (table === 'organization') rows = rows.map(row => ({ ...row,
      features: (row.features as Row[]).filter(feature => matches(feature, isObject((args.select as Row)?.features) ? ((args.select as Row).features as Row).where as Row : {})),
      accountOverlays: (row.accountOverlays as Row[]).filter(overlay => matches(overlay, isObject((args.select as Row)?.accountOverlays) ? ((args.select as Row).accountOverlays as Row).where as Row : {})),
    }));
    return method === 'findMany' ? rows : rows[0] ?? null;
  } }) }) as OhlqLoadReadinessDb;
  return { tables, db, calls, organization, run };
}

test('earlier healthy same-day facts certify readiness without any provider or write calls', async () => {
  const f = fixture();
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(row => row.source === 'BAILMENT_REPORTING' && row.status === 'PASS' && row.expected === 2 && row.actual === 2));
  assert.ok(result.checks.some(row => row.source === 'PRODUCTION_FORECAST' && row.actual === 1));
  assert.ok(f.tables.productionForecastRun[0].generatedAt! < f.tables.productionSourceImport[0].importedAt!);
  assert.equal(f.run.sourceCoverage.missingDates.length, 1); // pre-foundation gaps are valid
});

test('retained sales rows cannot disguise a failed receipt; certified zero rows are valid', async () => {
  const f = fixture();
  f.tables.ohlqReportImportStatus[0].status = 'ERRORED';
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'ANNUAL_SALES_SUMMARY' && row.code === 'SALES_NOT_CERTIFIED'));
  f.tables.ohlqReportImportStatus[0].status = 'COMPLETED';
  f.tables.ohlqReportImportStatus[0].rowCount = 0;
  f.tables.ohlqReportImportStatus[0].parsedRows = 0;
  f.tables.ohlqAnnualSalesRow.shift();
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.ready, true);
});

test('sales parse skips and raw count mismatches remain failures', async () => {
  const f = fixture();
  f.tables.ohlqReportImportStatus[0].skippedRows = 1;
  f.tables.ohlqAnnualSalesByWholesaleRow.pop();
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.code === 'SALES_NOT_CERTIFIED'));
  assert.ok(result.issues.some(row => row.code === 'SALES_ROWS_MISMATCH'));
  f.tables.ohlqReportImportStatus[0].errorMessage = 'private provider response must not enter diagnostics';
  assert.equal(JSON.stringify(await checkOhlqLoadReadiness(input, f.db)).includes('private provider'), false);
});

test('stale publication warnings require a valid older completed receipt and retained master data', async () => {
  const f = fixture();
  const receipt = f.tables.ohlqReportImportStatus.find(row => row.dataSource === 'ACCOUNT_MASTER')!;
  f.tables.ohlqReportImportStatus.push({ ...receipt, reportDate: d('2026-11-18') });
  Object.assign(receipt, { status: 'WARNING', diagnostics: { warningCode: 'SOURCE_NOT_UPDATED', availableDate: '2026-11-18', expectedDate: input.observationDate } });
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.ready, true);
  assert.equal(result.warnings[0].code, 'SOURCE_NOT_UPDATED_RETAINED');
  f.tables.ohlqReportImportStatus.pop();
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'ACCOUNT_MASTER'));
});

test('known legacy stale-master message is a warning, arbitrary failure text is not', async () => {
  const f = fixture();
  const receipt = f.tables.ohlqReportImportStatus.find(row => row.dataSource === 'BRAND_MASTER')!;
  f.tables.ohlqReportImportStatus.push({ ...receipt, reportDate: d('2026-11-18') });
  Object.assign(receipt, { status: 'ERRORED', errorMessage: "The newest Brand Master is dated 2026-11-18; expected today's Eastern date 2026-11-19." });
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
  receipt.errorMessage = 'Login failed; retained old Brand Master';
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, false);
});

test('enrollment matches importer predicates including target-only agencies and absent credentials', async () => {
  const f = fixture();
  f.organization.features = [];
  f.organization.accountOverlays = [{ accountType: 'AGENCY', isTargeting: true, externalAccountId: 'agency-a' }] as never[];
  f.tables.agency.push({ id: 'not-targeted', agencyId: '002' });
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.ready, true);
  assert.equal(result.checks.find(row => row.source === 'AGENCY_INTELLIGENCE')?.expected, 1);
  f.organization.ohlqCredentials = null as unknown as typeof f.organization.ohlqCredentials;
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.checks.some(row => row.source === 'AGENCY_INVENTORY'), false);
  f.organization.features = [{ id: 'agency', featureKey: 'AGENCY_INTELLIGENCE', enabled: true }];
  f.organization.active = false;
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.checks.some(row => row.organizationId), false);
  f.tables.organization.push({ ...f.organization, id: 'unrelated-active-tenant', active: true });
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.checks.some(row => row.organizationId), false);
});

test('actual observation date and complete inventory contents are required, excluded source rows are allowed', async () => {
  const f = fixture();
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
  f.tables.ohlqAgencyInventoryCurrent = [{ ...f.tables.ohlqAgencyInventoryCurrent[0], snapshotDate: d('2026-11-18') }];
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'AGENCY_INVENTORY'));
});

test('partial agency summaries or product fits cannot certify a finished intelligence sweep', async () => {
  const f = fixture();
  f.tables.agencyProductIntelligence = [];
  f.tables.agencyProductMarketFit = [];
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'AGENCY_INTELLIGENCE'));
  assert.ok(result.issues.some(row => row.source === 'AGENCY_MARKET_INTELLIGENCE'));
});

test('a source correction invalidates old agency and wholesale scores and ledger certification', async () => {
  const f = fixture();
  f.tables.ohlqReportImportStatus[3].updatedAt = d('2026-11-19T13:00:00Z');
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'AGENCY_INTELLIGENCE'));
  assert.ok(result.issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
});

test('a later failed wholesale sweep is not hidden by an older complete run', async () => {
  const f = fixture();
  f.tables.wholesaleAssessmentRun.push({ ...f.run, id: 'later-failed', startedAt: d('2026-11-19T13:00:00Z'), status: 'FAILED', persisted: 0 });
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
});

test('losing a represented historical ledger day invalidates a previously completed full sweep', async () => {
  const f = fixture();
  f.tables.ohlqReportImportStatus.push({ ...f.tables.ohlqReportImportStatus[1], reportDate: d('2026-11-16') });
  f.tables.wholesaleSalesLedgerDay.push({ ...f.tables.wholesaleSalesLedgerDay[0], reportDate: d('2026-11-16') });
  Object.assign(f.run.sourceCoverage, { from: '2026-11-16', representedDays: 3, completeDays: 3 });
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
  f.tables.wholesaleSalesLedgerDay.pop();
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
});

test('newer valid targeted assessments can coexist with a complete full sweep', async () => {
  const f = fixture();
  f.tables.wholesaleAccountAssessment[0].run = { ...f.run, id: 'targeted', fullSweep: false, startedAt: d('2026-11-19T13:00:00Z') };
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
  f.tables.wholesaleAccountAssessment[0].assessmentStatus = 'SOURCE_ERROR';
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
  for (const status of ['', 'COMPLETE', 'unrecognized']) {
    f.tables.wholesaleAccountAssessment[0].assessmentStatus = status;
    assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
  }
  f.tables.wholesaleAccountAssessment[0].assessmentStatus = 'UNRATED';
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
});

test('changed catalog configuration and incomplete full sweep counts block readiness', async () => {
  const f = fixture();
  f.tables.ohlqBrandMasterItem[0].retailPrice = 30;
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
  f.tables.ohlqBrandMasterItem[0].retailPrice = 25;
  f.run.skipped = 1;
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'WHOLESALE_INTELLIGENCE'));
});

test('a complete forecast requires exact current source provenance and every configured product snapshot', async () => {
  const f = fixture();
  f.tables.productionSourceImport.push({ ...f.tables.productionSourceImport[0], id: 'new-corrected-import', importedAt: d('2026-11-19T13:00:00Z') });
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.code === 'FORECAST_NOT_CURRENT'));
  f.tables.productionSourceImport.pop();
  f.tables.productionForecastSnapshot = [];
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.code === 'FORECAST_NOT_CURRENT'));
});

test('production imports require complete coverage even when zero source rows are valid', async () => {
  const f = fixture();
  f.tables.productionSourceImport[0].coverageEnd = d('2026-11-17');
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'BAILMENT_PO_INVOICE'));
  assert.ok(result.issues.some(row => row.code === 'FORECAST_INPUTS_UNAVAILABLE'));
  f.tables.productionSourceImport[0].coverageEnd = d('2026-11-18');
  (f.tables.productionSourceImport[0].summary as Row).directInvoicePolicy = 'shipment-only';
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'BAILMENT_PO_INVOICE'));
});

test('fresh forecasts cannot certify missing or stale native dashboard snapshots', async () => {
  for (const state of ['missing', 'stale']) {
    const f = fixture();
    if (state === 'missing') f.tables.ohlqBailmentReportingSnapshot = [];
    else Object.assign(f.tables.ohlqBailmentReportingSnapshot[0], { requestedAt: d('2026-11-18T12:00:00Z'), acquiredAt: d('2026-11-18T12:30:00Z'), requestedTo: d('2026-11-18') });
    const result = await checkOhlqLoadReadiness(input, f.db);
    assert.equal(result.ready, false, state);
    assert.deepEqual(result.issues.map(row => row.source), ['BAILMENT_REPORTING'], state);
    assert.ok(result.checks.some(row => row.source === 'PRODUCTION_FORECAST' && row.status === 'PASS'), state);
  }
});

test('native reporting requires the configured full history and native all-selection provenance', async () => {
  const invalid: [string, Row][] = [
    ['truncated history', { requestedFrom: d('2026-02-01') }],
    ['different history configuration', { requestedFrom: d('2025-01-01') }],
    ['wrong report', { reportIdentity: 'other-report' }],
    ['selected vendors only', { parameterScope: { parameter: 'Vendor', values: ['vendor-a'] } }],
    ['different parameter', { parameterScope: { parameter: 'Agency', values: 'all' } }],
    ['unsupported schema', { schemaVersion: 'other-schema' }],
    ['different source timezone', { timezone: 'UTC' }],
    ['acquired before request', { acquiredAt: d('2026-11-19T11:59:59Z') }],
  ];
  for (const [label, change] of invalid) {
    const f = fixture();
    Object.assign(f.tables.ohlqBailmentReportingSnapshot[0], change);
    const result = await checkOhlqLoadReadiness(input, f.db);
    assert.deepEqual(result.issues.map(row => row.source), ['BAILMENT_REPORTING'], label);
  }
  const f = fixture();
  f.tables.ohlqBailmentReportingSnapshot[0].parameterScope = { parameter: 'Brand', values: 'all' };
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
});

test('native snapshot freshness uses the frozen request date and accepts acquisition across midnight', async () => {
  const f = fixture();
  const snapshot = f.tables.ohlqBailmentReportingSnapshot[0];
  // 11:59 p.m. Eastern on the frozen day; a repeated unchanged export may
  // update the request metadata of a snapshot created on an earlier day.
  Object.assign(snapshot, { requestedAt: d('2026-11-20T04:59:00Z'), acquiredAt: d('2026-11-20T05:01:00Z') });
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
  snapshot.requestedAt = d('2026-11-20T05:00:00Z');
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'BAILMENT_REPORTING'));
  snapshot.requestedTo = d('2026-11-20');
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'BAILMENT_REPORTING'));
});

test('native reporting counts only rows belonging to the current organization and snapshot', async () => {
  const f = fixture();
  f.tables.ohlqBailmentReportingLine.push(
    { organizationId: 'other-tenant', snapshotId: 'native-report', sourceLineNumber: 1 },
    { organizationId: org, snapshotId: 'older-report', sourceLineNumber: 1 },
  );
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
  f.tables.ohlqBailmentReportingLine.shift();
  const result = await checkOhlqLoadReadiness(input, f.db);
  assert.deepEqual(result.issues.find(row => row.source === 'BAILMENT_REPORTING'), {
    source: 'BAILMENT_REPORTING', organizationId: org, date: input.observationDate,
    status: 'FAIL', code: 'BAILMENT_REPORTING_INCOMPLETE', expected: 2, actual: 1,
  });
});

test('the current native snapshot cannot fall back to an older complete publication', async () => {
  const f = fixture();
  f.tables.ohlqBailmentReportingSnapshot.push({ ...f.tables.ohlqBailmentReportingSnapshot[0], id: 'current-incomplete', requestId: 'request-z' });
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.issues.find(row => row.source === 'BAILMENT_REPORTING')?.actual, 0);
  f.tables.ohlqBailmentReportingLine.push(...[1, 2].map(sourceLineNumber => ({ organizationId: org, snapshotId: 'current-incomplete', sourceLineNumber })));
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.ready, true);
  Object.assign(f.tables.ohlqBailmentReportingSnapshot[0], { requestedAt: d('2026-11-19T13:00:00Z'), acquiredAt: d('2026-11-19T13:30:00Z'), rowCount: 3 });
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.issues.find(row => row.source === 'BAILMENT_REPORTING')?.expected, 3);
});

test('native reporting is checked independently when forecasting inputs or policy are unavailable', async () => {
  const f = fixture();
  f.organization.settings.productionForecasting.ohio.directInvoices = '';
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.checks.some(row => row.source === 'BAILMENT_REPORTING' && row.status === 'PASS'));
  assert.ok(result.issues.some(row => row.code === 'FORECAST_INPUTS_UNAVAILABLE'));
  f.tables.productionSourceImport = [];
  f.tables.ohlqBailmentReportingSnapshot = [];
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'BAILMENT_REPORTING'));
  assert.ok(result.issues.some(row => row.code === 'FORECAST_INPUTS_UNAVAILABLE'));
});

test('native reporting remains outside readiness for organizations excluded by source-worker enrollment', async () => {
  const exclusions: [string, Row][] = [
    ['another tenant', { id: 'other-tenant' }],
    ['inactive', { active: false }],
    ['suspended', { accountStatus: 'SUSPENDED' }],
    ['cancelled', { accountStatus: 'CANCELLED' }],
    ['Ohio disabled', { enabledStates: ['KY'] }],
    ['no credentials', { ohlqCredentials: null }],
    ['feature disabled', { features: [{ id: 'forecasting', featureKey: 'PRODUCTION_FORECASTING', enabled: false }] }],
  ];
  for (const [label, change] of exclusions) {
    const f = fixture();
    Object.assign(f.organization, change);
    f.tables.ohlqBailmentReportingSnapshot = [];
    const result = await checkOhlqLoadReadiness(input, f.db);
    assert.equal(result.checks.some(row => row.source === 'BAILMENT_REPORTING'), false, label);
    assert.equal(f.calls.some(call => call.table.startsWith('ohlqBailmentReporting')), false, label);
  }
});

test('temporary OpenDock lookup is a warning; authentication, malformed data and missing checks are failures', async () => {
  const f = fixture();
  const locations = ['GPT', 'GRN'].map((locationCode, index) => ({ market: 'OH', locationCode, locationName: locationCode, warehouseId: `00000000-0000-4000-8000-00000000000${index}`, loadTypeId: '00000000-0000-4000-8000-000000000009', timezone: 'America/New_York' }));
  Object.assign(f.organization.settings.productionForecasting, { operationalSignals: { opendock: { verifiedAt: at.toISOString(), locations } } });
  f.tables.deliveryAvailabilityObservation = [{ ...locations[0], organizationId: org, source: 'OPENDOCK', observedOn: d(input.observationDate), status: 'SUCCESS' }];
  f.tables.deliveryAvailabilityCheck = [{ ...locations[1], organizationId: org, source: 'OPENDOCK', observedOn: d(input.observationDate), status: 'UNAVAILABLE', diagnosticCode: 'OPENDOCK_RATE_LIMITED' }];
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.ready, true);
  assert.ok(result.warnings.some(row => row.source === 'OPENDOCK_GRN'));
  f.tables.deliveryAvailabilityCheck[0].diagnosticCode = 'INGESTION_FAILED';
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'OPENDOCK_GRN'));
  f.tables.deliveryAvailabilityCheck[0].status = 'AUTH_FAILED';
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'OPENDOCK_GRN'));
  f.tables.deliveryAvailabilityCheck = [];
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'OPENDOCK_GRN'));
});

test('same-day successful operational observations survive a later unsuccessful lookup', async () => {
  const f = fixture();
  f.tables.currentDemandCheck = [{ organizationId: org, productId: 'product-a', businessDate: d(input.observationDate), source: CURRENT_DEMAND_SOURCE, status: 'FAILED' }];
  f.tables.currentDcInventoryCheck = [{ organizationId: org, productId: 'product-a', locationCode: 'GPT', businessDate: d(input.observationDate), source: DC_INVENTORY_SOURCE, status: 'FAILED' }];
  assert.equal((await checkOhlqLoadReadiness(input, f.db)).ready, true);
});

test('database read failure propagates instead of incorrectly certifying readiness', async () => {
  const db = { ohlqReportImportStatus: { findMany: async () => { throw new Error('database unavailable'); } } } as unknown as OhlqLoadReadinessDb;
  await assert.rejects(checkOhlqLoadReadiness(input, db), /database unavailable/);
});

test('operational UNAVAILABLE is a warning while FAILED or absent daily evidence remains critical', async () => {
  const f = fixture();
  f.tables.currentDemandObservation = [];
  f.tables.currentDemandCheck = [{ organizationId: org, productId: 'product-a', businessDate: d(input.observationDate), source: CURRENT_DEMAND_SOURCE, status: 'UNAVAILABLE' }];
  let result = await checkOhlqLoadReadiness(input, f.db);
  assert.equal(result.ready, true);
  assert.ok(result.warnings.some(row => row.source === 'CURRENT_DEMAND'));
  f.tables.currentDemandCheck[0].status = 'FAILED';
  result = await checkOhlqLoadReadiness(input, f.db);
  assert.ok(result.issues.some(row => row.source === 'CURRENT_DEMAND'));
  f.tables.currentDcInventoryObservation.pop();
  assert.ok((await checkOhlqLoadReadiness(input, f.db)).issues.some(row => row.source === 'WAREHOUSE_INVENTORY'));
});

test('frozen inputs are validated and neither normalized in place nor replaced with wall clock', async () => {
  const f = fixture();
  const dates = Object.freeze(['2026-11-18', '2026-11-17', '2026-11-18']);
  const result = await checkOhlqLoadReadiness({ ...input, reportDates: dates }, f.db);
  assert.deepEqual(result.reportDates, input.reportDates);
  assert.equal(dates.length, 3);
  await assert.rejects(checkOhlqLoadReadiness({ reportDates: ['2026-02-30'], observationDate: input.observationDate }, f.db));
  await assert.rejects(checkOhlqLoadReadiness({ reportDates: [input.observationDate], observationDate: input.observationDate }, f.db));
});
