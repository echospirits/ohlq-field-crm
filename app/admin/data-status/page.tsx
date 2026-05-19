export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { OhlqReportDataSource, OhlqReportRunStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminSession } from '../../../lib/auth';
import { importOhlqBrandMasterCsv } from '../../../lib/ohlqBrandMasterImport';
import {
  formatOhlqDate,
  OHLQ_DATA_SOURCE_CONFIGS,
  toOhlqDateOnlyUtc,
} from '../../../lib/ohlqDataStatus';
import { getLatestManualOhlqReportDate } from '../../../lib/ohlqManualImport';
import { prisma } from '../../../lib/prisma';

const statusTimeZone = 'America/New_York';
const visibleDays = 14;

type SourceCell = {
  count: number;
  delta: number | null;
  errorMessage: string | null;
  lastSuccessfulAt: Date | null;
  source: OhlqReportDataSource;
  status: 'Not Yet Run' | 'Completed' | 'Errored' | 'Running';
};

const numberFormatter = new Intl.NumberFormat('en-US');

const reportDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

const runTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: statusTimeZone,
});

const formatRunTime = (date: Date | null | undefined) => (date ? runTimeFormatter.format(date) : 'No success yet');

const todayInEastern = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: statusTimeZone,
    year: 'numeric',
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Unable to resolve Eastern date part: ${type}`);
    return Number(part);
  };

  return {
    day: value('day'),
    month: value('month'),
    year: value('year'),
  };
};

const getReportDateRange = () => {
  const today = todayInEastern();

  return Array.from({ length: visibleDays }, (_, index) => {
    const offset = visibleDays - index;
    return formatOhlqDate(new Date(Date.UTC(today.year, today.month - 1, today.day - offset, 12)));
  });
};

const statusLabel = (status: OhlqReportRunStatus | undefined, count: number): SourceCell['status'] => {
  if (status === OhlqReportRunStatus.ERRORED) return 'Errored';
  if (status === OhlqReportRunStatus.RUNNING) return 'Running';
  if (status === OhlqReportRunStatus.COMPLETED || count > 0) return 'Completed';
  return 'Not Yet Run';
};

const statusClassName = (status: SourceCell['status']) => {
  if (status === 'Completed') return 'status-pill status-completed';
  if (status === 'Errored') return 'status-pill status-errored';
  if (status === 'Running') return 'status-pill status-running';
  return 'status-pill status-muted';
};

const formatDelta = (delta: number | null, count: number) => {
  if (delta === null || count === 0) return 'Baseline';
  if (delta === 0) return 'Same as previous day';
  return `${delta > 0 ? '+' : ''}${numberFormatter.format(delta)} vs previous day`;
};

const buildCountMap = (counts: Array<{ reportDate: Date; _count: { _all: number } }>) =>
  new Map(counts.map((item) => [formatOhlqDate(item.reportDate), item._count._all]));

const brandMasterStatusMessage = (params: {
  annualRows?: string;
  count?: string;
  date?: string;
  message?: string;
  replaced?: string;
  skipped?: string;
  status?: string;
  wholesaleRows?: string;
}) => {
  if (params.status === 'ohlq-imported') {
    return `OHLQ sales import finished for ${params.date ?? 'the selected date'}: ${
      params.annualRows ?? '0'
    } agency rows and ${params.wholesaleRows ?? '0'} wholesale rows loaded.`;
  }

  if (params.status === 'ohlq-queued') {
    return `OHLQ sales import queued in GitHub Actions for ${params.date ?? 'the selected date'}. Refresh this page after the workflow finishes.`;
  }

  if (params.status === 'ohlq-invalid') return 'Choose a valid past OHLQ report date before running the import.';
  if (params.status === 'ohlq-error') {
    return `OHLQ sales import failed: ${params.message ?? 'Unknown error'}`;
  }

  if (params.status === 'brand-master-imported') {
    return `Brand master refreshed: ${params.count ?? '0'} rows loaded, ${params.replaced ?? '0'} replaced, ${
      params.skipped ?? '0'
    } skipped.`;
  }

  if (params.status === 'brand-master-invalid') return 'Choose a brand master CSV file before importing.';
  if (params.status === 'brand-master-error') {
    return `Brand master import failed: ${params.message ?? 'Unknown error'}`;
  }

  return null;
};

const redirectWithDataStatus = (status: string, params?: Record<string, string | number>): never => {
  const query = new URLSearchParams({ status });

  for (const [key, value] of Object.entries(params ?? {})) {
    query.set(key, String(value));
  }

  redirect(`/admin/data-status?${query.toString()}`);
};

async function importBrandMaster(formData: FormData) {
  'use server';

  await requireAdminSession();
  const file = formData.get('brandMasterFile');

  if (!(file instanceof File) || file.size === 0) {
    redirect('/admin/data-status?status=brand-master-invalid');
  }

  let result: Awaited<ReturnType<typeof importOhlqBrandMasterCsv>>;
  try {
    result = await importOhlqBrandMasterCsv({ csv: await file.text() });
  } catch (error) {
    const message = encodeURIComponent((error instanceof Error ? error.message : String(error)).slice(0, 180));
    redirect(`/admin/data-status?status=brand-master-error&message=${message}`);
  }

  revalidatePath('/');
  revalidatePath('/admin/data-status');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  redirect(
    `/admin/data-status?status=brand-master-imported&count=${result.importedRows}&replaced=${result.deletedRows}&skipped=${result.skippedRows}`,
  );
}

export default async function DataStatusPage({
  searchParams,
}: {
  searchParams?: Promise<{
    count?: string;
    message?: string;
    replaced?: string;
    skipped?: string;
    status?: string;
    annualRows?: string;
    date?: string;
    wholesaleRows?: string;
  }>;
}) {
  await requireAdminSession();

  const params = (await searchParams) ?? {};
  const dates = getReportDateRange();
  const latestAllowedReportDate = getLatestManualOhlqReportDate();
  const startDate = toOhlqDateOnlyUtc(dates[0]);
  const endDate = toOhlqDateOnlyUtc(dates[dates.length - 1]);

  const [
    annualCounts,
    wholesaleCounts,
    statusRows,
    annualTotalRows,
    wholesaleTotalRows,
    brandMasterRows,
    latestBrandMasterRow,
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
    prisma.ohlqReportImportStatus.findMany({
      where: { reportDate: { gte: startDate, lte: endDate } },
      orderBy: [{ reportDate: 'asc' }, { dataSource: 'asc' }],
    }),
    prisma.ohlqAnnualSalesRow.count(),
    prisma.ohlqAnnualSalesByWholesaleRow.count(),
    prisma.ohlqBrandMasterItem.count(),
    prisma.ohlqBrandMasterItem.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
  ]);

  const countsBySource = {
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY]: buildCountMap(annualCounts),
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE]: buildCountMap(wholesaleCounts),
  };
  const totalRowsBySource = {
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY]: annualTotalRows,
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE]: wholesaleTotalRows,
  };
  const statusBySourceDate = new Map(statusRows.map((row) => [`${row.dataSource}:${formatOhlqDate(row.reportDate)}`, row]));
  const lastSuccessBySource = new Map<OhlqReportDataSource, Date>();

  statusRows.forEach((row) => {
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
      const cells = OHLQ_DATA_SOURCE_CONFIGS.map(({ source }) => {
        const count = countsBySource[source].get(date) ?? 0;
        const previousCount = previousDate ? countsBySource[source].get(previousDate) ?? 0 : null;
        const statusRow = statusBySourceDate.get(`${source}:${date}`);

        return {
          count,
          delta: previousCount === null ? null : count - previousCount,
          errorMessage: statusRow?.errorMessage ?? null,
          lastSuccessfulAt: statusRow?.lastSuccessfulAt ?? null,
          source,
          status: statusLabel(statusRow?.status, count),
        } satisfies SourceCell;
      });

      return { cells, date };
    });

  return (
    <>
      <h1>Data Status</h1>
      <p className="muted">OHLQ report health by report date, newest first.</p>
      {brandMasterStatusMessage(params) ? <p className="pill">{brandMasterStatusMessage(params)}</p> : null}

      <details className="card compact-details admin-panel" open>
        <summary>Run OHLQ Sales Import</summary>
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
          <button type="submit">Run or refresh import</button>
          <p className="muted data-status-form-note">
            Queues both OHLQ sales reports for the selected From/To date. Existing rows for that date are replaced
            during import, so this can refresh a completed day or recover a missed one.
          </p>
        </form>
      </details>

      <section className="data-source-grid" aria-label="Data source summary">
        {OHLQ_DATA_SOURCE_CONFIGS.map((config) => (
          <article className="card data-source-summary" key={config.source}>
            <div>
              <h2>{config.label}</h2>
              <p className="muted">{config.tableName}</p>
            </div>
            <p className="metric-value">{numberFormatter.format(totalRowsBySource[config.source])}</p>
            <p className="muted metric-caption">Total rows loaded</p>
            <div className="data-source-meta">
              <span>Most recent successful run</span>
              <strong>{formatRunTime(lastSuccessBySource.get(config.source))}</strong>
            </div>
          </article>
        ))}
        <article className="card data-source-summary">
          <div>
            <h2>Brand Master Lookup</h2>
            <p className="muted">OhlqBrandMasterItem</p>
          </div>
          <p className="metric-value">{numberFormatter.format(brandMasterRows)}</p>
          <p className="muted metric-caption">SKU/item lookup rows loaded</p>
          <div className="data-source-meta">
            <span>Most recent refresh</span>
            <strong>{formatRunTime(latestBrandMasterRow?.updatedAt)}</strong>
          </div>
        </article>
      </section>

      <details className="card compact-details admin-panel desktop-admin-panel">
        <summary>Import OHLQ Brand Master CSV</summary>
        <form action={importBrandMaster} encType="multipart/form-data">
          <input type="file" name="brandMasterFile" accept=".csv,text/csv" required />
          <button type="submit">Refresh brand master</button>
          <p className="muted">
            Each upload fully replaces the brand master lookup table, then reloads item code and item name data from
            the uploaded CSV.
          </p>
        </form>
      </details>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Daily Row Counts</h2>
          <span className="pill">Last {visibleDays} report dates</span>
        </div>

        <table className="responsive-table data-status-table">
          <thead>
            <tr>
              <th>Report date</th>
              {OHLQ_DATA_SOURCE_CONFIGS.map((config) => (
                <th key={config.source}>{config.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <td data-label="Report date">
                  <strong>{reportDateFormatter.format(toOhlqDateOnlyUtc(row.date))}</strong>
                  <span className="muted data-status-date">{row.date}</span>
                </td>
                {row.cells.map((cell) => (
                  <td data-label={OHLQ_DATA_SOURCE_CONFIGS.find((config) => config.source === cell.source)?.label} key={cell.source}>
                    <div className="data-status-cell">
                      <span className={statusClassName(cell.status)}>{cell.status}</span>
                      <strong>{numberFormatter.format(cell.count)} rows</strong>
                      <span className={cell.delta === 0 && cell.count > 0 ? 'data-delta data-delta-flat' : 'data-delta'}>
                        {formatDelta(cell.delta, cell.count)}
                      </span>
                      <span className="muted">Success: {formatRunTime(cell.lastSuccessfulAt)}</span>
                      {cell.errorMessage ? <span className="data-error-text">{cell.errorMessage}</span> : null}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
