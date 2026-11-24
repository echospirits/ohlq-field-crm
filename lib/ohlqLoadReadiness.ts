import { createHash } from 'node:crypto';
import type { Prisma, OhlqReportImportStatus } from '@prisma/client';
import { prisma } from './prisma';
import { ECHO_ORGANIZATION_ID } from './echoAccess';
import { formatDateInputValue } from './dateTime';
import { BAILMENT_REPORTING_REPORT_ID } from './ohlqBailmentReporting';
import { BAILMENT_REPORTING_SCHEMA_VERSION } from './ohlqBailmentReportingParser';
import { normalizeOhlqId } from './ohlqSalesData';
import { isLegacyOhlqStaleWarning } from './ohlqSourceFreshness';
import { AGENCY_INTELLIGENCE_RULES_VERSION, AGENCY_INTELLIGENCE_SCORING_VERSION } from './agencyIntelligenceConfig';
import { AGENCY_MARKET_SCORING_VERSION } from './agencyMarketIntelligence';
import { getAgencyMarketEligibleItemCodes } from './agencyMarketEligibility';
import { ASSESSMENT_VERSION } from './wholesaleAssessment';
import { reportRevision, representedWindow } from './wholesaleAssessmentCoverage';
import { wholesaleAssessmentConfigurationId } from './wholesaleAssessmentInputs';
import { loadRestaurantProductRestrictions } from './restaurantProductEligibility';
import { configuredProducts, loadForecastSources } from './productionForecasting/service';
import { MODEL_VERSION, forecastConfiguration, shift, validDay } from './productionForecasting/model';
import { parseDemandExclusions } from './productionForecasting/exclusions';
import { ohioSourceConfiguration } from './productionForecasting/sourceConfiguration';
import { openDockConfiguration } from './productionForecasting/operationalSignals/credentials';
import { isTemporaryOpenDockFailure } from './productionForecasting/operationalSignals/warnings';
import { CURRENT_DEMAND_CALCULATION_VERSION, CURRENT_DEMAND_SOURCE } from './productionForecasting/operationalSignals/demand';
import { DC_INVENTORY_ADAPTER_VERSION, DC_INVENTORY_SOURCE } from './productionForecasting/operationalSignals/dcInventory';

export type OhlqLoadReadinessInput = { reportDates: readonly string[]; observationDate: string };
export type OhlqLoadReadinessDb = Prisma.TransactionClient;
export type OhlqLoadReadinessCheck = {
  source: string;
  organizationId?: string;
  date: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  code: string;
  expected?: number;
  actual?: number;
};
export type OhlqLoadReadinessIssue = OhlqLoadReadinessCheck;
export type OhlqLoadReadinessResult = {
  ready: boolean;
  reportDates: string[];
  observationDate: string;
  checks: OhlqLoadReadinessCheck[];
  issues: OhlqLoadReadinessIssue[];
  warnings: OhlqLoadReadinessIssue[];
};

const day = (value: Date) => value.toISOString().slice(0, 10);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const watermark = (values: Array<Date | null | undefined>) => new Date(Math.max(0, ...values.map(value => value?.getTime() ?? 0)));
const completed = (row: Pick<OhlqReportImportStatus, 'status' | 'completedAt' | 'rowCount' | 'parsedRows'> | null | undefined) =>
  !!row && row.status === 'COMPLETED' && !!row.completedAt && Number.isInteger(row.rowCount) && row.rowCount >= 0 && Number.isInteger(row.parsedRows) && row.parsedRows >= 0;

/**
 * Verify persisted outcomes, independent of the current Actions attempt. All
 * dates are supplied by the caller once: crossing midnight cannot move the goal.
 * This function only reads. A database error propagates as unavailable evidence;
 * it must never be reported as healthy or replaced with a provider retry.
 */
export async function checkOhlqLoadReadiness(input: OhlqLoadReadinessInput, db: OhlqLoadReadinessDb = prisma): Promise<OhlqLoadReadinessResult> {
  const observationDate = input.observationDate;
  const reportDates = [...new Set(input.reportDates)].sort();
  if (!validDay(observationDate) || !reportDates.length || reportDates.some(value => !validDay(value) || value >= observationDate)) {
    throw new Error('Readiness requires valid sales dates before the frozen observation date.');
  }
  const checks: OhlqLoadReadinessCheck[] = [];
  const add = (source: string, at: string, ok: boolean, code: string, organizationId?: string, counts?: { expected: number; actual: number }) => {
    checks.push({ source, date: at, status: ok ? 'PASS' : 'FAIL', code: ok ? 'VERIFIED' : code, ...(organizationId ? { organizationId } : {}), ...counts });
  };
  const salesSources = ['ANNUAL_SALES_SUMMARY', 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE'] as const;
  const sales = await db.ohlqReportImportStatus.findMany({ where: { dataSource: { in: [...salesSources] }, reportDate: { in: reportDates.map(date) } } });
  for (const source of salesSources) for (const reportDate of reportDates) {
    const receipt = sales.find(row => row.dataSource === source && day(row.reportDate) === reportDate);
    const actual = source === 'ANNUAL_SALES_SUMMARY'
      ? await db.ohlqAnnualSalesRow.count({ where: { reportDate: date(reportDate) } })
      : await db.ohlqAnnualSalesByWholesaleRow.count({ where: { reportDate: date(reportDate) } });
    const trusted = completed(receipt) && receipt!.skippedRows === 0 && receipt!.parsedRows >= receipt!.rowCount;
    add(source, reportDate, trusted && actual === receipt!.rowCount,
      trusted ? 'SALES_ROWS_MISMATCH' : 'SALES_NOT_CERTIFIED', undefined, { expected: receipt?.rowCount ?? 0, actual });
  }

  // Master counts include intentionally excluded rows and directory merges.
  // Their importer verifies replacement; requiring parsedRows===rowCount would
  // reject healthy loads. Warnings require a trusted retained publication.
  for (const source of ['ACCOUNT_MASTER', 'BRAND_MASTER'] as const) {
    const receipt = await db.ohlqReportImportStatus.findUnique({ where: { dataSource_reportDate: { dataSource: source, reportDate: date(observationDate) } } });
    const retained = source === 'ACCOUNT_MASTER'
      ? await db.wholesaleAccount.count({ where: { isActive: true, mergedIntoId: null } })
      : await db.ohlqBrandMasterItem.count();
    if (completed(receipt) && receipt!.rowCount > 0 && retained > 0) {
      add(source, observationDate, true, 'MASTER_NOT_CERTIFIED');
      continue;
    }
    const diagnostics = object(receipt?.diagnostics);
    const legacy = receipt?.status === 'ERRORED' && isLegacyOhlqStaleWarning(source, receipt.errorMessage);
    const available = legacy ? /dated (\d{4}-\d{2}-\d{2})/.exec(receipt!.errorMessage!)?.[1] : diagnostics.availableDate;
    const expected = legacy ? /date (\d{4}-\d{2}-\d{2})\.$/.exec(receipt!.errorMessage!)?.[1] : diagnostics.expectedDate;
    const warning = (receipt?.status === 'WARNING' && diagnostics.warningCode === 'SOURCE_NOT_UPDATED') || legacy;
    const validWarning = warning && typeof available === 'string' && validDay(available) && available < observationDate && expected === observationDate;
    const prior = validWarning ? await db.ohlqReportImportStatus.findUnique({ where: { dataSource_reportDate: { dataSource: source, reportDate: date(available as string) } } }) : null;
    if (validWarning && completed(prior) && prior!.rowCount > 0 && retained > 0) {
      checks.push({ source, date: observationDate, status: 'WARNING', code: 'SOURCE_NOT_UPDATED_RETAINED' });
    } else add(source, observationDate, false, 'MASTER_NOT_CERTIFIED');
  }

  const activeEcho = { id: ECHO_ORGANIZATION_ID, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } } satisfies Prisma.OrganizationWhereInput;
  // These enrollment predicates intentionally match each corresponding worker.
  const [inventoryTenants, marketTenants, assessmentTenants, productionTenants, operationalTenants] = await Promise.all([
    db.organization.findMany({ where: { ...activeEcho, ohlqCredentials: { isNot: null }, OR: [
      { features: { some: { enabled: true, featureKey: 'AGENCY_INTELLIGENCE' } } },
      { accountOverlays: { some: { accountType: 'AGENCY', isTargeting: true } } },
    ] }, select: { id: true, features: { where: { enabled: true, featureKey: 'AGENCY_INTELLIGENCE' }, select: { id: true } }, accountOverlays: { where: { accountType: 'AGENCY', isTargeting: true }, select: { externalAccountId: true } } } }),
    db.organization.findMany({ where: { ...activeEcho, features: { some: { enabled: true, featureKey: 'AGENCY_INTELLIGENCE' } } }, select: { id: true } }),
    db.organization.findMany({ where: { ...activeEcho, features: { some: { enabled: true, featureKey: 'WHOLESALE_OPPORTUNITIES' } } }, select: { id: true } }),
    db.organization.findMany({ where: { ...activeEcho, enabledStates: { has: 'OH' }, ohlqCredentials: { isNot: null }, features: { some: { enabled: true, featureKey: 'PRODUCTION_FORECASTING' } } }, select: { id: true, settings: true, enabledStates: true, timezone: true } }),
    db.organization.findMany({ where: { ...activeEcho, enabledStates: { has: 'OH' }, features: { some: { enabled: true, featureKey: 'PRODUCTION_FORECASTING' } } }, select: { id: true, settings: true, ohlqCredentials: { select: { organizationId: true } } } }),
  ]);
  const agencies = inventoryTenants.length || marketTenants.length ? (await db.agency.findMany({ select: { id: true, agencyId: true } })).filter(row => !!normalizeOhlqId(row.agencyId)) : [];
  const salesWatermark = watermark(sales.map(row => row.updatedAt));
  const latestSalesDate = reportDates.at(-1)!;

  for (const tenant of inventoryTenants) {
    const organizationId = tenant.id;
    const receipt = await db.ohlqTenantInventoryImportStatus.findUnique({ where: { organizationId_reportDate: { organizationId, reportDate: date(observationDate) } } });
    const [snapshots, current, currentTotal] = await Promise.all([
      db.ohlqAgencyInventorySnapshot.count({ where: { organizationId, snapshotDate: date(observationDate) } }),
      db.ohlqAgencyInventoryCurrent.count({ where: { organizationId, snapshotDate: date(observationDate) } }),
      db.ohlqAgencyInventoryCurrent.count({ where: { organizationId } }),
    ]);
    add('AGENCY_INVENTORY', observationDate, completed(receipt) && snapshots === receipt!.rowCount && current === snapshots && currentTotal === current,
      'INVENTORY_NOT_CERTIFIED', organizationId, { expected: receipt?.rowCount ?? 0, actual: snapshots });
    const expectedAgencies = tenant.features.length ? agencies : agencies.filter(agency => tenant.accountOverlays.some(overlay => overlay.externalAccountId === agency.id));
    const ids = expectedAgencies.map(row => row.id);
    const after = watermark([salesWatermark, receipt?.updatedAt]);
    const [summaries, products] = await Promise.all([
      db.agencyIntelligenceSummary.findMany({ where: { organizationId, agencyId: { in: ids } }, select: { agencyId: true, asOfDate: true, rulesVersion: true, scoringVersion: true, updatedAt: true, signalSnapshot: true } }),
      db.agencyProductIntelligence.findMany({ where: { organizationId, agencyId: { in: ids } }, select: { agencyId: true, itemCode: true, asOfDate: true, rulesVersion: true, scoringVersion: true, updatedAt: true } }),
    ]);
    const productMap = new Map(products.map(row => [`${row.agencyId}:${row.itemCode}`, row]));
    const valid = summaries.filter(row => {
      if (day(row.asOfDate) !== observationDate || row.rulesVersion !== AGENCY_INTELLIGENCE_RULES_VERSION || row.scoringVersion !== AGENCY_INTELLIGENCE_SCORING_VERSION || row.updatedAt < after) return false;
      const expectedProducts = object(row.signalSnapshot).products;
      return Array.isArray(expectedProducts) && expectedProducts.every(item => {
        const itemCode = object(object(item).signals).itemCode;
        const product = typeof itemCode === 'string' ? productMap.get(`${row.agencyId}:${itemCode}`) : null;
        return !!product && day(product.asOfDate) === observationDate && product.rulesVersion === row.rulesVersion && product.scoringVersion === row.scoringVersion && product.updatedAt >= after;
      });
    });
    add('AGENCY_INTELLIGENCE', observationDate, valid.length === ids.length, 'AGENCY_INTELLIGENCE_INCOMPLETE', organizationId, { expected: ids.length, actual: valid.length });
  }

  for (const tenant of marketTenants) {
    const organizationId = tenant.id;
    const [catalog, decisions, listings, inventory, profiles, fits] = await Promise.all([
      db.ohlqBrandMasterItem.findMany(),
      db.organizationProduct.findMany({ where: { organizationId, market: 'OH', active: true, discontinued: false, status: { in: ['OWNED', 'REPRESENTED'] } } }),
      db.ohlqAgencyInventoryCurrent.findMany({ where: { organizationId }, select: { itemCode: true, detailCodeDescription: true, status: true } }),
      db.ohlqTenantInventoryImportStatus.findFirst({ where: { organizationId, status: 'COMPLETED' }, orderBy: { reportDate: 'desc' }, select: { diagnostics: true, updatedAt: true } }),
      db.agencyMarketProfile.findMany({ where: { organizationId }, select: { agencyId: true, asOfDate: true, scoringVersion: true, updatedAt: true } }),
      db.agencyProductMarketFit.findMany({ where: { organizationId }, select: { agencyId: true, itemCode: true, asOfDate: true, scoringVersion: true, updatedAt: true } }),
    ]);
    const eligible = getAgencyMarketEligibleItemCodes({ catalog, listings, diagnostics: inventory?.diagnostics });
    const codes = [...new Set(decisions.filter(row => eligible.has(row.externalItemCode)).map(row => row.externalItemCode))];
    const after = watermark([salesWatermark, inventory?.updatedAt, ...catalog.map(row => row.updatedAt), ...decisions.map(row => row.updatedAt)]);
    const valid = (row: { asOfDate: Date; scoringVersion: string; updatedAt: Date }) => day(row.asOfDate) >= latestSalesDate && row.scoringVersion === AGENCY_MARKET_SCORING_VERSION && row.updatedAt >= after;
    const profileMap = new Map(profiles.filter(valid).map(row => [row.agencyId, row]));
    const fitKeys = new Set(fits.filter(valid).map(row => `${row.agencyId}:${row.itemCode}`));
    const verified = agencies.filter(agency => profileMap.has(agency.id) && codes.every(code => fitKeys.has(`${agency.id}:${code}`))).length;
    add('AGENCY_MARKET_INTELLIGENCE', latestSalesDate, verified === agencies.length, 'AGENCY_MARKET_INTELLIGENCE_INCOMPLETE', organizationId, { expected: agencies.length, actual: verified });
  }

  for (const tenant of assessmentTenants) {
    const organizationId = tenant.id;
    const asOf = [shift(observationDate, -1), latestSalesDate].sort().at(-1)!;
    const run = await db.wholesaleAssessmentRun.findFirst({ where: { organizationId, fullSweep: true }, orderBy: { startedAt: 'desc' } });
    const sweepAsOf = run?.asOfDate ? day(run.asOfDate) : asOf;
    const readFrom = [shift(sweepAsOf, -89), ...reportDates].sort()[0];
    const [decisions, catalog, accounts, reports, ledgers, assessments] = await Promise.all([
      db.organizationProduct.findMany({ where: { organizationId } }),
      db.ohlqBrandMasterItem.findMany(),
      db.wholesaleAccount.findMany({ where: { mergedIntoId: null }, select: { id: true } }),
      db.ohlqReportImportStatus.findMany({ where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', reportDate: { gte: date(readFrom), lte: date(sweepAsOf) } }, orderBy: { reportDate: 'asc' } }),
      db.wholesaleSalesLedgerDay.findMany({ where: { organizationId, reportDate: { gte: date(readFrom), lte: date(sweepAsOf) } } }),
      db.wholesaleAccountAssessment.findMany({ where: { organizationId, wholesaleAccount: { mergedIntoId: null } }, select: { wholesaleAccountId: true, asOfDate: true, modelVersion: true, configurationId: true, assessmentStatus: true, calculatedAt: true, run: { select: { status: true, completedAt: true, startedAt: true, modelVersion: true, configurationId: true, sourceCoverage: true } } } }),
    ]);
    // Same fingerprint as the scorer: corrected catalog/portfolio input must not
    // silently certify an old completed assessment sweep.
    const restrictedItemCodes = await loadRestaurantProductRestrictions(organizationId, db, catalog);
    const configurationId = wholesaleAssessmentConfigurationId(decisions, catalog, restrictedItemCodes);
    const ledgerMap = new Map(ledgers.map(row => [day(row.reportDate), row]));
    const certified = (report: OhlqReportImportStatus) => {
      const ledger = ledgerMap.get(day(report.reportDate));
      return completed(report) && report.skippedRows === 0 && ledger?.sourceRevision === reportRevision(report) && ledger.sourceRows === report.rowCount;
    };
    const requestedCertified = reportDates.every(value => reports.some(row => day(row.reportDate) === value && certified(row)));
    const windowReports = reports.filter(row => day(row.reportDate) >= shift(sweepAsOf, -89));
    const certifiedDates = new Set(windowReports.filter(certified).map(row => day(row.reportDate)));
    const represented = representedWindow(date(sweepAsOf), certifiedDates);
    const coverage = object(run?.sourceCoverage);
    const coverageCurrent = represented.days > 0 && coverage.from === represented.from && coverage.through === represented.through
      && coverage.representedDays === represented.days && coverage.completeDays === certifiedDates.size
      && !!windowReports.at(-1) && certified(windowReports.at(-1)!);
    const after = watermark(windowReports.map(row => row.updatedAt));
    const accountIds = new Set(accounts.map(row => row.id));
    const current = assessments.filter(row => accountIds.has(row.wholesaleAccountId) && day(row.asOfDate) >= asOf && row.modelVersion === ASSESSMENT_VERSION && row.configurationId === configurationId
      && ['READY', 'UNRATED', 'INELIGIBLE'].includes(row.assessmentStatus) && row.calculatedAt >= after
      && row.run.status === 'COMPLETED' && !!row.run.completedAt && row.run.startedAt >= after && row.run.modelVersion === ASSESSMENT_VERSION && row.run.configurationId === configurationId
      && object(row.run.sourceCoverage).status === 'REPRESENTED_PERIOD_COMPLETE');
    const ok = !!run && run.status === 'COMPLETED' && !!run.completedAt && run.modelVersion === ASSESSMENT_VERSION && run.configurationId === configurationId && !!run.asOfDate && day(run.asOfDate) >= asOf && run.startedAt >= after
      && run.expected === accounts.length && run.persisted === run.expected && run.failed === 0 && run.skipped === 0 && object(run.sourceCoverage).status === 'REPRESENTED_PERIOD_COMPLETE'
      && requestedCertified && coverageCurrent && current.length === accounts.length;
    add('WHOLESALE_INTELLIGENCE', asOf, ok, 'WHOLESALE_INTELLIGENCE_INCOMPLETE', organizationId, { expected: accounts.length, actual: current.length });
  }

  for (const tenant of productionTenants) {
    const organizationId = tenant.id;
    const config = ohioSourceConfiguration(tenant.settings);
    // Check the same current snapshot exposed by the reporting view. Never
    // select an older valid receipt to hide an incomplete current publication.
    // Native reporting is independent of forecasting's invoice-policy gate.
    const reporting = await db.ohlqBailmentReportingSnapshot.findFirst({ where: { organizationId }, orderBy: [{ requestedAt: 'desc' }, { requestId: 'desc' }] });
    const reportingRows = reporting ? await db.ohlqBailmentReportingLine.count({ where: { organizationId, snapshotId: reporting.id } }) : 0;
    const reportingScope = object(reporting?.parameterScope);
    const reportingCurrent = !!reporting && !!config.historyStart
      && day(reporting.requestedFrom) === config.historyStart && day(reporting.requestedTo) === observationDate
      && reporting.timezone === tenant.timezone && formatDateInputValue(reporting.requestedAt, tenant.timezone) === observationDate
      && reporting.acquiredAt >= reporting.requestedAt
      && reporting.reportIdentity === BAILMENT_REPORTING_REPORT_ID && reporting.schemaVersion === BAILMENT_REPORTING_SCHEMA_VERSION
      && (reportingScope.parameter === 'Vendor' || reportingScope.parameter === 'Brand') && reportingScope.values === 'all'
      && Number.isInteger(reporting.rowCount) && reporting.rowCount > 0 && reportingRows === reporting.rowCount;
    add('BAILMENT_REPORTING', observationDate, reportingCurrent, 'BAILMENT_REPORTING_INCOMPLETE', organizationId, { expected: reporting?.rowCount ?? 0, actual: reportingRows });
    const asOf = shift(observationDate, -1);
    let sourcesReady = true;
    for (const source of ['BAILMENT_PO_INVOICE', 'DISTRIBUTION_CENTER'] as const) {
      const receipt = await db.productionSourceImport.findFirst({ where: { organizationId, market: 'OH', source, observedOn: date(observationDate), status: 'COMPLETE' }, orderBy: { importedAt: 'desc' } });
      const ok = !!receipt && object(receipt.summary).completenessConfirmed === true && (source === 'BAILMENT_PO_INVOICE'
        ? !!config.historyStart && !!config.directInvoices && object(receipt.summary).directInvoicePolicy === config.directInvoices && day(receipt.coverageStart) <= config.historyStart && day(receipt.coverageEnd) === asOf
        : day(receipt.coverageStart) === observationDate && day(receipt.coverageEnd) === observationDate);
      sourcesReady &&= ok;
      add(source, observationDate, ok, 'PRODUCTION_SOURCE_INCOMPLETE', organizationId);
    }
    if (!sourcesReady) {
      add('PRODUCTION_FORECAST', observationDate, false, 'FORECAST_INPUTS_UNAVAILABLE', organizationId);
      continue;
    }
    const products = await configuredProducts(db, organizationId, tenant.enabledStates);
    const demandExclusions = parseDemandExclusions(tenant.settings);
    const sources = await loadForecastSources(db, organizationId, products, asOf, demandExclusions);
    // generatedAt is the source workflow's START time, before source imports.
    // Exact provenance is the existing immutable run key, never that timestamp.
    const runKey = createHash('sha256').update(JSON.stringify({ today: observationDate, version: MODEL_VERSION, config: forecastConfiguration(tenant.settings), demandExclusions, products, imports: sources.imports.map(row => row.id), guidance: sources.guidance })).digest('hex');
    const run = await db.productionForecastRun.findUnique({ where: { organizationId_runKey: { organizationId, runKey } }, select: { id: true, horizonStart: true, modelVersion: true } });
    const snapshots = run ? await db.productionForecastSnapshot.findMany({ where: { organizationId, runId: run.id }, select: { productId: true, horizonStart: true, horizonEnd: true } }) : [];
    const saved = new Set(snapshots.filter(row => day(row.horizonStart) === observationDate && day(row.horizonEnd) === shift(observationDate, 29)).map(row => row.productId));
    const actual = products.filter(row => saved.has(row.id)).length;
    add('PRODUCTION_FORECAST', observationDate, !!run && run.modelVersion === MODEL_VERSION && day(run.horizonStart) === observationDate && actual === products.length,
      'FORECAST_NOT_CURRENT', organizationId, { expected: products.length, actual });
  }
  for (const tenant of operationalTenants) {
    const organizationId = tenant.id;
    const configuration = openDockConfiguration(tenant.settings);
    if (configuration.configured) {
      const where = { organizationId, source: 'OPENDOCK', market: 'OH', observedOn: date(observationDate) };
      const [observations, attempts] = await Promise.all([
        db.deliveryAvailabilityObservation.findMany({ where, select: { locationCode: true, warehouseId: true, loadTypeId: true, timezone: true, status: true } }),
        db.deliveryAvailabilityCheck.findMany({ where, select: { locationCode: true, warehouseId: true, loadTypeId: true, timezone: true, status: true, diagnosticCode: true } }),
      ]);
      for (const location of configuration.locations) {
        const matches = (row: { locationCode: string; warehouseId: string; loadTypeId: string; timezone: string }) => row.locationCode === location.locationCode && row.warehouseId === location.warehouseId && row.loadTypeId === location.loadTypeId && row.timezone === location.timezone;
        const observed = observations.some(row => matches(row) && ['SUCCESS', 'NO_AVAILABILITY'].includes(row.status));
        const attempt = attempts.find(matches);
        const source = `OPENDOCK_${location.locationCode}`;
        if (observed) add(source, observationDate, true, 'DELIVERY_CHECK_MISSING', organizationId);
        else if (attempt && (attempt.status === 'NOT_CONFIGURED' || attempt.status === 'UNAVAILABLE' && isTemporaryOpenDockFailure({ status: 'UNAVAILABLE', diagnosticCode: attempt.diagnosticCode }))) {
          checks.push({ source, organizationId, date: observationDate, status: 'WARNING', code: attempt.status === 'NOT_CONFIGURED' ? 'DELIVERY_NOT_CONFIGURED' : 'DELIVERY_TEMPORARILY_UNAVAILABLE' });
        } else add(source, observationDate, false, 'DELIVERY_CHECK_FAILED_OR_MISSING', organizationId);
      }
    }
    // The daily worker deliberately skips OPS sources without credentials.
    // Read only relation presence; the verifier neither decrypts nor uses them.
    if (!tenant.ohlqCredentials) continue;
    const products = await configuredProducts(db, organizationId, ['OH']);
    const where = { organizationId, productId: { in: products.map(row => row.id) }, businessDate: date(observationDate) };
    const [demand, demandChecks, stock, stockChecks] = await Promise.all([
      db.currentDemandObservation.findMany({ where: { ...where, source: CURRENT_DEMAND_SOURCE, calculationVersion: CURRENT_DEMAND_CALCULATION_VERSION }, select: { productId: true } }),
      db.currentDemandCheck.findMany({ where: { ...where, source: CURRENT_DEMAND_SOURCE }, select: { productId: true, status: true } }),
      db.currentDcInventoryObservation.findMany({ where: { ...where, source: DC_INVENTORY_SOURCE, sourceBusinessDate: date(observationDate), adapterVersion: DC_INVENTORY_ADAPTER_VERSION }, select: { productId: true, locationCode: true } }),
      db.currentDcInventoryCheck.findMany({ where: { ...where, source: DC_INVENTORY_SOURCE }, select: { productId: true, locationCode: true, status: true } }),
    ]);
    const demandIds = new Set(demand.map(row => row.productId));
    const stockKeys = new Set(stock.map(row => `${row.productId}:${row.locationCode}`));
    // UNAVAILABLE is a recorded source limitation under the scheduled worker's
    // existing policy; FAILED/missing checks cannot be hidden by a forecast.
    for (const source of ['CURRENT_DEMAND', 'WAREHOUSE_INVENTORY'] as const) {
      let available = 0, unavailable = 0;
      const expected = products.length * (source === 'CURRENT_DEMAND' ? 1 : 2);
      for (const product of products) for (const location of source === 'CURRENT_DEMAND' ? [''] : ['GPT', 'GRN']) {
        if (source === 'CURRENT_DEMAND' ? demandIds.has(product.id) : stockKeys.has(`${product.id}:${location}`)) available++;
        else if ((source === 'CURRENT_DEMAND' ? demandChecks.find(row => row.productId === product.id) : stockChecks.find(row => row.productId === product.id && row.locationCode === location))?.status === 'UNAVAILABLE') unavailable++;
      }
      if (available + unavailable === expected && unavailable > 0) checks.push({ source, organizationId, date: observationDate, status: 'WARNING', code: 'OPTIONAL_SOURCE_DATA_UNAVAILABLE', expected, actual: available });
      else add(source, observationDate, available === expected, 'OPERATIONAL_SOURCE_FAILED_OR_MISSING', organizationId, { expected, actual: available });
    }
  }
  return { ready: checks.every(check => check.status !== 'FAIL'), reportDates, observationDate, checks, issues: checks.filter(check => check.status === 'FAIL'), warnings: checks.filter(check => check.status === 'WARNING') };
}
