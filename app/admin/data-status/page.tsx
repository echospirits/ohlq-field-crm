export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import '../admin-workspace.css';
import { SubmitButton } from '../../components/SubmitButton';
import { ohlqStatusLabel } from '../../../lib/ohlqSourceFreshness';
import { OhlqReportDataSource, OhlqReportRunStatus, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireEchoAdminSession, requireUserSession } from '../../../lib/auth';
import { isAdminRole } from '../../../lib/userAccess';
import { EASTERN_TIME_ZONE, formatEasternDateInputValue, formatEasternDateTime, getZonedDateTimeParts } from '../../../lib/dateTime';
import { importOhlqBrandMasterCsv } from '../../../lib/ohlqBrandMasterImport';
import {
  formatOhlqDate,
  OHLQ_DATA_SOURCE_CONFIGS,
  recordOhlqReportRunCompleted,
  recordOhlqReportRunErrored,
  recordOhlqReportRunStarted,
  toOhlqDateOnlyUtc,
} from '../../../lib/ohlqDataStatus';
import { getLatestManualOhlqReportDate } from '../../../lib/ohlqManualImport';
import { prisma } from '../../../lib/prisma';
import { requireOrganizationContext } from '../../../lib/organizations';
import { PageHeader, SectionHeading } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Data Status');

const statusTimeZone = EASTERN_TIME_ZONE;
const visibleDays = 14;

const DAILY_DATA_SOURCE_CONFIGS = [
  { source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY, label: 'Retail sales' },
  { source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE, label: 'Restaurant sales' },
  { source: OhlqReportDataSource.AGENCY_INVENTORY_REPORT, label: 'Retail inventory' },
  { source: OhlqReportDataSource.ACCOUNT_MASTER, label: 'Account Master' },
  { source: OhlqReportDataSource.BRAND_MASTER, label: 'Brand Master' },
] as const;

type SourceCell = {
  count: number;
  delta: number | null;
  diagnostics: unknown;
  errorMessage: string | null;
  lastSuccessfulAt: Date | null;
  source: OhlqReportDataSource;
  status: 'Not Yet Run' | 'Completed' | 'Errored' | 'Running' | 'Warning';
};

const numberFormatter = new Intl.NumberFormat('en-US');

const reportDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

const formatRunTime = (date: Date | null | undefined) => formatEasternDateTime(date) || 'No success yet';

const todayInEastern = () => getZonedDateTimeParts(new Date(), statusTimeZone);

const getReportDateRange = () => {
  const today = todayInEastern();

  return Array.from({ length: visibleDays }, (_, index) => {
    const offset = visibleDays - 1 - index;
    return formatOhlqDate(new Date(Date.UTC(today.year, today.month - 1, today.day - offset, 12)));
  });
};

const statusLabel = ohlqStatusLabel;

const statusClassName = (status: SourceCell['status']) => {
  if (status === 'Completed') return 'status-pill status-completed';
  if (status === 'Errored') return 'status-pill status-errored';
  if (status === 'Running') return 'status-pill status-running';
  if (status === 'Warning') return 'status-pill status-running';
  return 'status-pill status-muted';
};

const formatDelta = (delta: number | null, count: number) => {
  if (delta === null || count === 0) return 'Baseline';
  if (delta === 0) return 'Same as previous day';
  return `${delta > 0 ? '+' : ''}${numberFormatter.format(delta)} vs previous day`;
};

type AccountMasterMetrics = {
  created: number;
  deactivated: number;
  updated: number;
};

type BrandMasterMetrics = {
  created: number;
  removed: number;
  updated: number;
};

const getMetricCount = (diagnostics: unknown, key: string) => {
  const values = diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)
    ? diagnostics as Record<string, unknown>
    : {};
  const value = values[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

const getAccountMasterMetrics = (diagnostics: unknown): AccountMasterMetrics => {
  return {
    created: getMetricCount(diagnostics, 'createdWholesaleAccounts'),
    deactivated: getMetricCount(diagnostics, 'deactivatedWholesaleAccounts'),
    updated: getMetricCount(diagnostics, 'updatedWholesaleAccounts'),
  };
};

const getBrandMasterMetrics = (diagnostics: unknown): BrandMasterMetrics => ({
  created: getMetricCount(diagnostics, 'createdItems'),
  removed: getMetricCount(diagnostics, 'removedItems'),
  updated: getMetricCount(diagnostics, 'updatedItems'),
});

const buildCountMap = (counts: Array<{ reportDate: Date; _count: { _all: number } }>) =>
  new Map(counts.map((item) => [formatOhlqDate(item.reportDate), item._count._all]));

const brandMasterStatusMessage = (params: {
  annualRows?: string;
  count?: string;
  created?: string;
  date?: string;
  inventoryRows?: string;
  message?: string;
  productsDiscovered?: string;
  removed?: string;
  skipped?: string;
  status?: string;
  updated?: string;
  wholesaleRows?: string;
}) => {
  if (params.status === 'ohlq-imported') {
    return `OHLQ data refresh finished for ${params.date ?? 'the selected sales date'}: ${
      params.annualRows ?? '0'
    } retail sales rows, ${params.wholesaleRows ?? '0'} restaurant rows, and ${
      params.inventoryRows ?? '0'
    } current inventory rows loaded.`;
  }

  if (params.status === 'ohlq-queued') {
    return `OHLQ sales import queued in GitHub Actions for ${params.date ?? 'the selected date'}. Refresh this page after the workflow finishes.`;
  }

  if (params.status === 'ohlq-invalid') return 'Choose a valid past OHLQ report date before running the import.';
  if (params.status === 'ohlq-error') {
    return `OHLQ sales import failed: ${params.message ?? 'Unknown error'}`;
  }

  if (params.status === 'brand-master-imported') {
    return `Brand master refreshed: ${params.count ?? '0'} rows loaded; ${params.created ?? '0'} created, ${
      params.updated ?? '0'
    } updated, ${params.removed ?? '0'} removed, and ${params.skipped ?? '0'} skipped; ${
      params.productsDiscovered ?? '0'
    } new organization product candidates added for review.`;
  }

  if (params.status === 'brand-master-invalid') return 'Choose a brand master CSV file before importing.';
  if (params.status === 'brand-master-error') {
    return `Brand master import failed: ${params.message ?? 'Unknown error'}`;
  }

  return null;
};

async function importBrandMaster(formData: FormData) {
  'use server';

  await requireEchoAdminSession();
  const file = formData.get('brandMasterFile');

  if (!(file instanceof File) || file.size === 0) {
    redirect('/admin/data-status?status=brand-master-invalid');
  }

  const reportDate = formatEasternDateInputValue();
  await recordOhlqReportRunStarted({ reportDate, source: OhlqReportDataSource.BRAND_MASTER });

  let result: Awaited<ReturnType<typeof importOhlqBrandMasterCsv>>;
  try {
    result = await importOhlqBrandMasterCsv({ csv: await file.text() });
    const diagnostics = {
      createdItems: result.createdItems,
      organizationsScanned: result.organizationsScanned,
      productsDiscovered: result.productsDiscovered,
      removedItems: result.removedItems,
      unchangedItems: result.unchangedItems,
      updatedItems: result.updatedItems,
    };
    await recordOhlqReportRunCompleted({
      downloadResult: { filename: file.name, sizeBytes: file.size },
      importResult: { ...result, diagnostics, reportDate },
      source: OhlqReportDataSource.BRAND_MASTER,
    });
  } catch (error) {
    await recordOhlqReportRunErrored({ error, reportDate, source: OhlqReportDataSource.BRAND_MASTER }).catch(
      (statusError) => console.error('Unable to record Brand Master import error status:', statusError),
    );
    const message = encodeURIComponent((error instanceof Error ? error.message : String(error)).slice(0, 180));
    redirect(`/admin/data-status?status=brand-master-error&message=${message}`);
  }

  revalidatePath('/');
  revalidatePath('/admin/data-status');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  redirect(
    `/admin/data-status?status=brand-master-imported&count=${result.importedRows}&created=${result.createdItems}&updated=${result.updatedItems}&removed=${result.removedItems}&skipped=${result.skippedRows}&productsDiscovered=${result.productsDiscovered}`,
  );
}

export default async function DataStatusPage({
  searchParams,
}: {
  searchParams?: Promise<{
    count?: string;
    created?: string;
    message?: string;
    removed?: string;
    skipped?: string;
    status?: string;
    updated?: string;
    annualRows?: string;
    date?: string;
    inventoryRows?: string;
    productsDiscovered?: string;
    wholesaleRows?: string;
  }>;
}) {
  const session = await requireUserSession({ allowTaster: true });
  const canRefresh = isAdminRole(session.user.role);
  const { organizationId } = await requireOrganizationContext(session.user);

  const params = (await searchParams) ?? {};
  const dates = getReportDateRange();
  const latestAllowedReportDate = getLatestManualOhlqReportDate();
  const githubDispatchConfigured = Boolean(process.env.GITHUB_ACTIONS_DISPATCH_TOKEN?.trim());
  const productionNeedsGithubDispatch = process.env.VERCEL === '1' && !githubDispatchConfigured;
  const startDate = toOhlqDateOnlyUtc(dates[0]);
  const endDate = toOhlqDateOnlyUtc(dates[dates.length - 1]);

  const [
    annualCounts,
    wholesaleCounts,
    inventoryCounts,
    statusRows,
    annualTotalRows,
    wholesaleTotalRows,
    inventoryTotalRows,
    brandMasterRows,
    latestBrandMasterRow,
    latestAccountMasterRun,
    latestAccountMasterSuccess,
    latestBrandMasterRun,
    latestBrandMasterSuccess,
    tenantInventoryStatusRows,
  ] = await Promise.all([
    prisma.ohlqAnnualSalesRow.groupBy({
      by: ['reportDate'],
      where: { reportDate: { gte: startDate, lte: endDate } },
      _count: { _all: true },
      orderBy: { reportDate: 'asc' },
    }),
    prisma.ohlqAnnualSalesByWholesaleRow.groupBy({
      by: ['reportDate'],
      where: { reportDate: { gte: startDate, lte: endDate } },
      _count: { _all: true },
      orderBy: { reportDate: 'asc' },
    }),
    prisma.ohlqAgencyInventorySnapshot.groupBy({
      by: ['snapshotDate'],
      where: { organizationId, snapshotDate: { gte: startDate, lte: endDate } },
      _count: { _all: true },
      orderBy: { snapshotDate: 'asc' },
    }),
    prisma.ohlqReportImportStatus.findMany({
      where: { dataSource: { not: OhlqReportDataSource.AGENCY_INVENTORY_REPORT }, reportDate: { gte: startDate, lte: endDate } },
      orderBy: [{ reportDate: 'asc' }, { dataSource: 'asc' }],
    }),
    prisma.ohlqAnnualSalesRow.count(),
    prisma.ohlqAnnualSalesByWholesaleRow.count(),
    prisma.ohlqAgencyInventorySnapshot.count({ where: { organizationId } }),
    prisma.ohlqBrandMasterItem.count(),
    prisma.ohlqBrandMasterItem.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
    prisma.ohlqReportImportStatus.findFirst({
      where: { dataSource: OhlqReportDataSource.ACCOUNT_MASTER },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.ohlqReportImportStatus.findFirst({
      where: {
        dataSource: OhlqReportDataSource.ACCOUNT_MASTER,
        status: OhlqReportRunStatus.COMPLETED,
      },
      orderBy: { lastSuccessfulAt: 'desc' },
    }),
    prisma.ohlqReportImportStatus.findFirst({
      where: { dataSource: OhlqReportDataSource.BRAND_MASTER },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.ohlqReportImportStatus.findFirst({
      where: {
        dataSource: OhlqReportDataSource.BRAND_MASTER,
        status: OhlqReportRunStatus.COMPLETED,
      },
      orderBy: { lastSuccessfulAt: 'desc' },
    }),
    prisma.ohlqTenantInventoryImportStatus.findMany({ where: { organizationId, reportDate: { gte: startDate, lte: endDate } }, orderBy: { reportDate: 'asc' } }),
  ]);

  const allStatusRows = [
    ...statusRows,
    ...tenantInventoryStatusRows.map((row) => ({ ...row, dataSource: OhlqReportDataSource.AGENCY_INVENTORY_REPORT })),
  ];

  const accountMasterMetrics = getAccountMasterMetrics(latestAccountMasterSuccess?.diagnostics);
  const brandMasterMetrics = getBrandMasterMetrics(latestBrandMasterSuccess?.diagnostics);
  const latestAccountMasterStatus = statusLabel(latestAccountMasterRun?.status, 0, 'ACCOUNT_MASTER', latestAccountMasterRun?.errorMessage);
  const latestBrandMasterStatus = statusLabel(latestBrandMasterRun?.status, brandMasterRows, 'BRAND_MASTER', latestBrandMasterRun?.errorMessage);
  const legacyBrandMasterDate = latestBrandMasterRow?.updatedAt
    ? formatEasternDateInputValue(latestBrandMasterRow.updatedAt)
    : null;

  const countsBySource = new Map<OhlqReportDataSource, Map<string, number>>([
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY, buildCountMap(annualCounts)],
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE, buildCountMap(wholesaleCounts)],
    [OhlqReportDataSource.AGENCY_INVENTORY_REPORT, new Map(
      inventoryCounts.map((item) => [formatOhlqDate(item.snapshotDate), item._count._all]),
    )],
    [OhlqReportDataSource.ACCOUNT_MASTER, new Map()],
    [
      OhlqReportDataSource.BRAND_MASTER,
      new Map(legacyBrandMasterDate ? [[legacyBrandMasterDate, brandMasterRows]] : []),
    ],
  ]);
  const totalRowsBySource = {
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY]: annualTotalRows,
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE]: wholesaleTotalRows,
    [OhlqReportDataSource.AGENCY_INVENTORY_REPORT]: inventoryTotalRows,
  };
  const statusBySourceDate = new Map(allStatusRows.map((row) => [`${row.dataSource}:${formatOhlqDate(row.reportDate)}`, row]));
  const lastSuccessBySource = new Map<OhlqReportDataSource, Date>();

  allStatusRows.forEach((row) => {
    if (!row.lastSuccessfulAt) return;
    const existing = lastSuccessBySource.get(row.dataSource);
    if (!existing || existing.getTime() < row.lastSuccessfulAt.getTime()) {
      lastSuccessBySource.set(row.dataSource, row.lastSuccessfulAt);
    }
  });

  const rows = dates
    .slice()
    .reverse()
    .map((date, index, reversedDates) => {
      const previousDate = reversedDates[index + 1] ?? null;
      const cells = DAILY_DATA_SOURCE_CONFIGS.map(({ source }) => {
        const statusRow = statusBySourceDate.get(`${source}:${date}`);
        const count = countsBySource.get(source)?.get(date) ?? statusRow?.rowCount ?? 0;
        const previousStatusRow = previousDate ? statusBySourceDate.get(`${source}:${previousDate}`) : null;
        const previousCount = previousDate
          ? countsBySource.get(source)?.get(previousDate) ?? previousStatusRow?.rowCount ?? 0
          : null;
        const legacyBrandMasterSuccess = source === OhlqReportDataSource.BRAND_MASTER
          && date === legacyBrandMasterDate
          && !statusRow
          ? latestBrandMasterRow?.updatedAt ?? null
          : null;

        return {
          count,
          delta: previousCount === null ? null : count - previousCount,
          diagnostics: statusRow?.diagnostics ?? null,
          errorMessage: statusRow?.errorMessage ?? null,
          lastSuccessfulAt: statusRow?.lastSuccessfulAt ?? legacyBrandMasterSuccess,
          source,
          status: statusLabel(statusRow?.status, count, source, statusRow?.errorMessage),
        } satisfies SourceCell;
      });

      return { cells, date };
    });

  return (
    <div className="admin-workspace">
      <PageHeader
        title="Data Status"
      />
      {brandMasterStatusMessage(params) ? <p className="toast-notice page-status">{brandMasterStatusMessage(params)}</p> : null}
      <section className="workspace-section" aria-label="Data source summary">
        <SectionHeading title="Source overview" />
        <div className="table-scroll" role="region" aria-label="Data source rows and successful imports" tabIndex={0}><table className="comparison-table admin-source-table"><thead><tr><th scope="col">Source</th><th scope="col" className="numeric">Loaded rows</th><th scope="col">Latest successful import</th><th scope="col">Status / latest changes</th></tr></thead><tbody>
          {OHLQ_DATA_SOURCE_CONFIGS.map(config => <tr key={config.source}>
            <th scope="row">{config.label}</th><td className="numeric">{numberFormatter.format(totalRowsBySource[config.source])}</td><td>{formatRunTime(lastSuccessBySource.get(config.source))}</td><td><a href="#daily-row-counts">Daily run history</a></td>
          </tr>)}
          <tr><th scope="row">Account Master</th><td className="numeric">{typeof latestAccountMasterSuccess?.rowCount === 'number' ? numberFormatter.format(latestAccountMasterSuccess.rowCount) : 'Unavailable'}<small>Active restaurant accounts</small></td><td>{formatRunTime(latestAccountMasterSuccess?.lastSuccessfulAt)}{latestAccountMasterSuccess ? <small>Source {formatOhlqDate(latestAccountMasterSuccess.reportDate)}</small> : null}</td><td><span className={statusClassName(latestAccountMasterStatus)}>{latestAccountMasterStatus}</span>{latestAccountMasterSuccess ? <small>{numberFormatter.format(accountMasterMetrics.created)} created · {numberFormatter.format(accountMasterMetrics.updated)} updated · {numberFormatter.format(accountMasterMetrics.deactivated)} deactivated</small> : null}{latestAccountMasterRun?.errorMessage ? <p className={latestAccountMasterStatus === 'Warning' ? 'muted' : 'data-error-text'}>{latestAccountMasterStatus === 'Warning' ? 'Warning' : 'Latest attempt'}: {latestAccountMasterRun.errorMessage}</p> : null}</td></tr>
          <tr><th scope="row">Brand Master Lookup</th><td className="numeric">{numberFormatter.format(brandMasterRows)}<small>SKU/item lookup rows</small></td><td>{formatRunTime(latestBrandMasterSuccess?.lastSuccessfulAt ?? latestBrandMasterRow?.updatedAt)}{latestBrandMasterSuccess ? <small>Source {formatOhlqDate(latestBrandMasterSuccess.reportDate)}</small> : null}</td><td><span className={statusClassName(latestBrandMasterStatus)}>{latestBrandMasterStatus}</span>{latestBrandMasterSuccess ? <small>{numberFormatter.format(brandMasterMetrics.created)} created · {numberFormatter.format(brandMasterMetrics.updated)} updated · {numberFormatter.format(brandMasterMetrics.removed)} removed</small> : null}{latestBrandMasterRun?.errorMessage ? <p className={latestBrandMasterStatus === 'Warning' ? 'muted' : 'data-error-text'}>{latestBrandMasterStatus === 'Warning' ? 'Warning' : 'Latest attempt'}: {latestBrandMasterRun.errorMessage}</p> : null}</td></tr>
        </tbody></table></div>
      </section>
      {canRefresh ? <details className="card compact-details admin-panel">
        <summary>Run OHLQ Data Refresh</summary>
        <form action="/api/admin/ohlq-manual-import" method="post" className="data-status-action-form">
          <label>
            Report date
            <input
              type="date"
              name="reportDate"
              defaultValue={latestAllowedReportDate}
              max={latestAllowedReportDate}
              required
            />
          </label>
          <button disabled={productionNeedsGithubDispatch} type="submit">
            {productionNeedsGithubDispatch ? 'Configure GitHub runner first' : 'Run or refresh import'}
          </button>
          <p className="muted data-status-form-note">
            {productionNeedsGithubDispatch
              ? 'Add GITHUB_ACTIONS_DISPATCH_TOKEN in Vercel before production can queue the cloud runner.'
              : 'Queues the current Account Master and Brand Master first, then both dated OHLQ sales reports and the current Agency Inventory Report. Sales rows use the selected date; current files use their actual Eastern download date.'}
          </p>
        </form>
      </details> : null}

      {canRefresh ? <details className="card compact-details admin-panel desktop-admin-panel">
        <summary>Import OHLQ Brand Master CSV</summary>
        <form action={importBrandMaster} encType="multipart/form-data">
          <input type="file" name="brandMasterFile" accept=".csv,text/csv" required />
          <SubmitButton type="submit">Refresh brand master</SubmitButton>
          <p className="muted">
            Each upload fully replaces the brand master lookup table, then reloads item code and item name data from
            the uploaded CSV.
          </p>
        </form>
      </details> : null}

      <section className="dashboard-section" id="daily-row-counts">
        <SectionHeading actions={<span className="pill">Last {visibleDays} report dates</span>} title="Daily Row Counts" />

        <div className="table-scroll" role="region" aria-label="Daily source row counts and run status" tabIndex={0}><table className="comparison-table data-status-table data-status-table-compact">
          <thead>
            <tr>
              <th>Report date</th>
              {DAILY_DATA_SOURCE_CONFIGS.map((config) => (
                <th key={config.source}>{config.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <td data-label="Report date">
                  <strong>{reportDateFormatter.format(toOhlqDateOnlyUtc(row.date))}</strong>
                </td>
                {row.cells.map((cell) => (
                  <td data-label={DAILY_DATA_SOURCE_CONFIGS.find((config) => config.source === cell.source)?.label} key={cell.source}>
                    <div className="data-status-cell">
                      <span className={statusClassName(cell.status)}>{cell.status}</span>
                      {cell.status === 'Warning' ? (
                        <><strong>Import skipped</strong><span className="muted">Previous data retained</span></>
                      ) : <>
                      <strong>{numberFormatter.format(cell.count)} {cell.source === OhlqReportDataSource.ACCOUNT_MASTER ? 'active' : 'rows'}</strong>
                      {cell.source === OhlqReportDataSource.ACCOUNT_MASTER ? (
                        <span className="data-delta">
                          +{numberFormatter.format(getAccountMasterMetrics(cell.diagnostics).created)} created · {numberFormatter.format(getAccountMasterMetrics(cell.diagnostics).updated)} updated · {numberFormatter.format(getAccountMasterMetrics(cell.diagnostics).deactivated)} deactivated
                        </span>
                      ) : cell.source === OhlqReportDataSource.BRAND_MASTER ? (
                        <span className="data-delta">+{numberFormatter.format(getBrandMasterMetrics(cell.diagnostics).created)} created · {numberFormatter.format(getBrandMasterMetrics(cell.diagnostics).updated)} updated · {numberFormatter.format(getBrandMasterMetrics(cell.diagnostics).removed)} removed</span>
                      ) : (
                        <span className={cell.delta === 0 && cell.count > 0 ? 'data-delta data-delta-flat' : 'data-delta'}>
                          {formatDelta(cell.delta, cell.count)}
                        </span>
                      )}
                      </>}
                      <span className="muted">Success: {formatRunTime(cell.lastSuccessfulAt)}</span>
                      {cell.errorMessage ? <p className={cell.status === 'Warning' ? 'data-status-source-warning' : 'data-error-text'}><strong>{cell.status === 'Warning' ? 'Source warning' : 'Latest error'}: </strong>{cell.errorMessage}</p> : null}
                      {cell.diagnostics ? (
                        <details className="compact-details">
                          <summary>Import diagnostics</summary>
                          <pre>{JSON.stringify(cell.diagnostics, null, 2)}</pre>
                        </details>
                      ) : null}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
