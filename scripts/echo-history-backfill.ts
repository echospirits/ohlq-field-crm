import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import Papa from 'papaparse';
import { prisma } from '../lib/prisma';
import { downloadOhlqEchoSalesPairs, type OhlqAnnualSalesDownloadResult } from '../lib/ohlqAnnualSalesReport';
import { importOhlqAnnualSalesCsv, parseOhlqAnnualSalesByWholesaleCsv } from '../lib/ohlqAnnualSalesImport';

const vendor = 'Z90399001';
const start = '2019-09-01';
const end = '2026-11-21';
// Both native wholesale export scopes lacked required identifiers on these dates.
// Keep them in the verification query until corrected evidence is available.
const deferredSourceDates = new Set(['2025-04-12', '2024-12-19', '2022-12-02', '2022-11-17', '2022-11-02', '2021-10-16', '2021-08-25', '2021-08-06', '2021-07-21', '2020-11-07']);
const lineagePermitHash = 'ec5011cb0d29c3cdc9b0d0230312c10256ddf0bcb99a85946f36ed64c1928c34';
const wholesaleId = 'dea7572c-2ea4-45bb-bbbc-29600bd326cc';
let day: string | undefined;
let stage = 'target';
let report: string | undefined;
const sha = (s: Buffer) => createHash('sha256').update(Uint8Array.from(s)).digest('hex');

const daySignatures = (projection: Prisma.Sql, source: Prisma.Sql, order: Prisma.Sql, totals = Prisma.empty) => Prisma.sql`
  SELECT "reportDate", count(*)::int AS n,${totals}
    encode(sha256(convert_to(jsonb_agg(${projection} ORDER BY ${order})::text,'UTF8')),'hex') AS sha
  FROM ${source} GROUP BY "reportDate"
`;
const summarySignatures = daySignatures(Prisma.sql`jsonb_build_array(
  to_char("reportDate",'YYYY-MM-DD'),"agencyId",vendor,brand,"retailBottlesSold","wholesaleBottlesSold")`,
  Prisma.sql`(SELECT * FROM "OhlqAnnualSalesRow" WHERE vendor=${vendor} AND "reportDate" BETWEEN ${start}::date AND ${end}::date) grouped`,
  Prisma.sql`"agencyId" COLLATE "C",vendor COLLATE "C",brand COLLATE "C"`,
  Prisma.sql`sum("retailBottlesSold") AS retail, sum("wholesaleBottlesSold") AS wholesale,`);
const detailProjection = Prisma.sql`jsonb_build_array("agencyId",brand,"permitNumber","wholesaleBottlesSold")`;
const detailOrder = Prisma.sql`"agencyId" COLLATE "C",brand COLLATE "C","permitNumber" COLLATE "C"`;
const detailSignatures = daySignatures(detailProjection,
  Prisma.sql`(SELECT * FROM "OhlqAnnualSalesByWholesaleRow" WHERE vendor=${vendor} AND "reportDate" BETWEEN ${start}::date AND ${end}::date) grouped`, detailOrder);
const emptyHash = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

async function remaining() {
  return prisma.$queryRaw<{ date: string }[]>`
    WITH summary AS (${summarySignatures}), detail AS (${detailSignatures}),
    dates AS (SELECT d::date AS day FROM generate_series(${start}::date,${end}::date,interval '1 day') d)
    SELECT to_char(day,'YYYY-MM-DD') AS date
    FROM dates LEFT JOIN "EchoBottleSalesDayCoverage" c ON c."reportDate"=day
    LEFT JOIN summary s ON s."reportDate"=day LEFT JOIN detail w ON w."reportDate"=day
    WHERE c."reportDate" IS NULL OR c."completedAt">now() OR c."expectedRowCount"<>coalesce(s.n,0)
      OR c."expectedRetailBottles"<>coalesce(s.retail,0)
      OR c."expectedWholesaleBottles"<>coalesce(s.wholesale,0)
      OR c."expectedFactsSha256"<>coalesce(s.sha,${emptyHash})
      OR NOT (
        (c."requestReference" LIKE 'echo-pair:%' AND split_part(c."requestReference",':',3)=coalesce(w.sha,${emptyHash}))
        OR (day BETWEEN DATE '2026-09-01' AND DATE '2026-09-30' AND c."requestReference"='echo-history:44953866117')
        OR (c."requestReference" ~ '^daily:[0-9]+$'
          AND EXISTS (SELECT 1 FROM "OhlqReportImportStatus" AS w WHERE w."reportDate"=day
            AND w."dataSource"='ANNUAL_SALES_SUMMARY_BY_WHOLESALE' AND w.status='COMPLETED'
            AND w."skippedRows"=0
            AND w."lastSuccessfulAt" BETWEEN c."completedAt" AND c."completedAt"+interval '30 minutes'))
      )
    ORDER BY day DESC`;
}

function wholesaleRows(result: OhlqAnnualSalesDownloadResult, date: string, lineagePermit: string | undefined) {
  const e = result.echoWholesaleExport;
  if (!e || e.reportIdentity !== wholesaleId || e.date !== date || result.reportDate !== date) {
    throw Error('Invalid wholesale source evidence.');
  }
  if (e.verifiedEmpty) {
    if (e.statewide || result.csvBuffer || result.sizeBytes) throw Error('Inconsistent wholesale empty export.');
    return { rows: [], csvHash: 'provider-empty', lineageRows: 0 };
  }
  const bytes = result.csvBuffer;
  if (!bytes || !bytes.length || bytes.length !== result.sizeBytes) throw Error('Incomplete wholesale bytes.');
  const input = Papa.parse(bytes.toString('utf8'), { header: true, skipEmptyLines: true }) as {
    data: Record<string, string>[];
    errors: unknown[];
    meta: { fields?: string[]; renamedHeaders?: Record<string, string> };
  };
  const columns = input.meta.fields ?? [];
  if (input.errors.length) throw Error('Wholesale CSV did not parse.');
  if (Object.keys(input.meta.renamedHeaders ?? {}).length) throw Error('Wholesale CSV has duplicate headers.');
  const sourceKeys = ['Agency_Id', 'DimVendor_VendorNumber_', 'Brand', 'Permit_Number', 'Wholesale_Bottles_Sold'];
  if (sourceKeys.some(key => !columns.includes(key))) throw Error('Wholesale source columns are missing.');
  if (input.data.some(row => !row.DimVendor_VendorNumber_?.trim())) throw Error('Wholesale source contains an unknown vendor.');
  const scoped = e.statewide ? input.data.filter(row => row.DimVendor_VendorNumber_.trim() === vendor) : input.data;
  if (!scoped.length && e.statewide) return { rows: [], csvHash: sha(bytes), lineageRows: 0 };
  if (scoped.some(row => !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(row.Wholesale_Bottles_Sold?.trim() ?? '') &&
      row.Wholesale_Bottles_Sold?.trim() !== '')) throw Error('Wholesale quantity syntax is invalid.');
  const lineageRows = lineagePermit && !e.statewide && columns.includes('Doing_Business_As') && columns.includes('Permit_Number')
    ? input.data.filter(row => row.DimVendor_VendorNumber_?.trim() === vendor && !row.Permit_Number?.trim() &&
        row.Doing_Business_As?.trim().toUpperCase() === 'LINEAGE BREWING' &&
        row.Agency_Id?.trim() && row.Brand?.trim() && row.Wholesale_Bottles_Sold?.trim())
    : [];
  if (lineagePermit) for (const row of lineageRows) row.Permit_Number = lineagePermit;
  const corrected = lineageRows.length || e.statewide ? Papa.unparse(scoped, { columns }) : bytes;
  const parsed = parseOhlqAnnualSalesByWholesaleCsv(corrected, date);
  if (parsed.skippedRows) {
    const missing = Object.fromEntries(['Agency_Id', 'DimVendor_VendorNumber_', 'Brand', 'Permit_Number']
      .map(key => [key, scoped.filter(row => !row[key]?.trim()).length]));
    console.log(JSON.stringify({ date, scope: e.statewide ? 'statewide' : 'echo', sourceRowsMissingKeys: parsed.skippedRows, echoMissingByField: missing }));
    throw Error('Wholesale rows are missing key identifiers.');
  }
  if (scoped.length !== parsed.rows.length) throw Error('Wholesale CSV has repeated row keys.');
  if (!e.statewide && parsed.rows.some(row => row.vendor !== vendor)) throw Error('Wholesale rows are outside the Echo scope.');
  if (parsed.rows.some(row => row.wholesaleBottlesSold! < -2147483648 || row.wholesaleBottlesSold! > 2147483647)) {
    throw Error('Wholesale quantity is outside the supported integer range.');
  }
  return { rows: parsed.rows, csvHash: sha(bytes), lineageRows: lineageRows.length };
}

async function attachDetail(tx: Prisma.TransactionClient, date: string, input: ReturnType<typeof wholesaleRows>) {
  const when = new Date(date + 'T00:00:00Z');
  const where = { reportDate: when, vendor };
  const rows = input.rows.map(x=>({agencyId:x.agencyId,brand:x.brand,permitNumber:x.permitNumber,wholesaleBottlesSold:x.wholesaleBottlesSold}));
  const digest = (table: Prisma.Sql) => Prisma.sql`SELECT count(*)::int n,
    encode(sha256(convert_to(coalesce(jsonb_agg(${detailProjection} ORDER BY ${detailOrder})::text,'[]'),'UTF8')),'hex') sha
    FROM ${table}`;
  const [expected] = await tx.$queryRaw<{ n: number; sha: string }[]>(digest(Prisma.sql`
    jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x("agencyId" text,brand text,"permitNumber" text,"wholesaleBottlesSold" integer)`));
  await tx.ohlqAnnualSalesByWholesaleRow.deleteMany({ where });
  if (rows.length) {
    const inserted = await tx.ohlqAnnualSalesByWholesaleRow.createMany({ data: rows.map(x => ({ ...x, ...where })) });
    if (inserted.count !== rows.length) throw Error('Incomplete wholesale insert.');
  }
  const [actual] = await tx.$queryRaw<{ n: number; sha: string }[]>(digest(Prisma.sql`
    (SELECT * FROM "OhlqAnnualSalesByWholesaleRow" WHERE vendor=${vendor} AND "reportDate"=${date}::date) x`));
  if (expected.n !== actual.n || expected.sha !== actual.sha) throw Error('Persisted wholesale differs from verified source.');
  return 'echo-pair:' + process.env.GITHUB_RUN_ID + ':' + actual.sha + ':' + input.csvHash +
    (input.lineageRows ? ':user-confirmed-lineage-dba' : '');
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.GITHUB_REPOSITORY !== 'echospirits/ohlq-field-crm' ||
      process.env.APP_ENV !== 'production' || process.env.DATABASE_ENVIRONMENT !== 'production' ||
      !/^ep-proud-recipe-amosj8m9(-pooler)?\.c-5\.us-east-1\.aws\.neon\.tech$/.test(url.hostname) ||
      url.pathname !== '/neondb' || ![null,'public'].includes(url.searchParams.get('schema'))) throw Error('Invalid target.');
  const [target] = await prisma.$queryRaw<{db:string;schema:string;isPrimary:boolean}[]>`
    SELECT current_database() db,current_schema() schema,NOT pg_is_in_recovery() AS "isPrimary"`;
  if (target?.db !== 'neondb' || target.schema !== 'public' || !target.isPrimary) throw Error('Invalid database session.');
  const permits = await prisma.$queryRaw<{ permit: string }[]>`
    SELECT DISTINCT "licenseeId" AS permit FROM "WholesaleLicenseeId"
    WHERE encode(sha256(convert_to("licenseeId",'UTF8')),'hex')=${lineagePermitHash}
  `;
  const lineagePermit = permits.length === 1 ? permits[0].permit : undefined;
  const unconfirmed = await remaining();
  const pending = unconfirmed.filter(row => !deferredSourceDates.has(row.date));
  const deferred = unconfirmed.filter(row => deferredSourceDates.has(row.date)).map(row => row.date);
  if (deferred.length) console.log(JSON.stringify({ deferred, reason: 'Unresolved wholesale key integrity in both native export scopes.' }));
  const limit = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 24 : 4;
  console.log(JSON.stringify({ from: pending[0]?.date, missing: pending.length, limit }));
  const reprobe = process.env.GITHUB_EVENT_NAME === 'push' && deferred.includes('2024-12-19') ? ['2024-12-19'] : [];
  const batch = [...reprobe, ...pending.slice(0, limit).map(row => row.date)].sort().reverse();
  let processed = 0;
  let attempts = 0;

  while (processed < batch.length) {
    day = batch[processed];
    stage = 'sign-in';
    report = undefined;
    try {
      await downloadOhlqEchoSalesPairs(batch.slice(processed), {
        headless: true,
        logger: { log() {}, error() {} },
        onDiagnostic: diagnostic => {
          if (typeof diagnostic.stage === 'string') stage = diagnostic.stage;
          if (typeof diagnostic.historyReport === 'string') report = diagnostic.historyReport;
        },
      }, date => {
        day = date;
        stage = 'download';
        report = undefined;
        console.log(JSON.stringify({ starting: date }));
      }, async (summary, wholesale, acquireStatewideWholesale) => {
        stage = 'validate-summary-evidence';
        const info = summary.summaryNativeExport;
        if (!summary.csvBuffer || summary.csvBuffer.length !== summary.sizeBytes || !info || day !== summary.reportDate) {
          throw Error('Incomplete summary bytes.');
        }
        stage = 'validate-wholesale-source';
        let detail: ReturnType<typeof wholesaleRows>;
        try {
          detail = wholesaleRows(wholesale, summary.reportDate, lineagePermit);
        } catch (error) {
          if (!(error instanceof Error) || !(
            error.message === 'Wholesale rows are missing key identifiers.' ||
            error.message === 'Wholesale CSV has repeated row keys.' ||
            error.message.startsWith('OHLQ wholesale CSV contains conflicting duplicate rows')
          )) throw error;
          console.log(JSON.stringify({ date: summary.reportDate, fallback: 'statewide-wholesale' }));
          const statewide = await acquireStatewideWholesale();
          stage = 'validate-statewide-wholesale-source';
          try {
            detail = wholesaleRows(statewide, summary.reportDate, lineagePermit);
          } catch (fallbackError) {
            if (!reprobe.includes(summary.reportDate) || !(fallbackError instanceof Error) ||
                fallbackError.message !== 'Wholesale rows are missing key identifiers.') throw fallbackError;
            processed += 1;
            attempts = 0;
            console.log(JSON.stringify({ date: summary.reportDate, sourceStillUnconfirmed: true }));
            return;
          }
        }
        stage = 'validate-summary-and-persist';
        const result = await importOhlqAnnualSalesCsv({
          csv: summary.csvBuffer, reportDate: summary.reportDate, echoOnly: true,
          evidence: { native: info, requestReference: 'echo-pair:' + process.env.GITHUB_RUN_ID },
          pairedWholesale: async tx => {
            stage = 'persist-wholesale';
            const reference = await attachDetail(tx, summary.reportDate, detail);
            stage = 'reconcile-summary';
            return reference;
          },
        });
        processed += 1;
        attempts = 0;
        console.log(JSON.stringify({ date: summary.reportDate, summary: result.importedRows, wholesale: detail.rows.length, lineagePermitRows: detail.lineageRows, committed: true }));
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TimeoutError' || ++attempts >= 3) throw error;
      console.log(JSON.stringify({ retrying: day, report, stage, attempt: attempts + 1 }));
      await delay(attempts * 15000);
    }
  }
  const stillUnconfirmed = await remaining();
  const outstanding = stillUnconfirmed.filter(row => !deferredSourceDates.has(row.date));
  console.log(JSON.stringify({ outstanding: stillUnconfirmed.length, actionable: outstanding.length, next: outstanding[0]?.date, deferred }));
  if (pending.length && outstanding.length>=pending.length) throw Error('No durable backfill progress.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'remaining='+outstanding.length+'\n');
}
main().catch((e:unknown)=>{
  const code=e && typeof e==='object' && 'code' in e && /^P\d{4}$/.test(String(e.code)) ? String(e.code):undefined;
  const message = e instanceof Error ? e.message : '';
  const safeErrors = [["Invalid wholesale bottle quantity","wholesale-quantity"],["Unable to parse OHLQ wholesale CSV","wholesale-csv"],["OHLQ wholesale CSV is missing","wholesale-headers"],["OHLQ wholesale CSV contains conflicting duplicate","wholesale-conflicting-keys"],["Unable to parse OHLQ CSV","summary-csv"],["OHLQ CSV is missing","summary-headers"],["Invalid signed integer in OHLQ sales summary","summary-quantity"],["Invalid integer value in OHLQ CSV","summary-quantity"]];
  const reason = /^[A-Za-z -]+\.$/.test(message) ? message : safeErrors.find(([prefix]) => message.startsWith(prefix))?.[1];
  console.error(JSON.stringify({day,report,stage,code,reason,timeout:e instanceof Error && e.name==='TimeoutError'}));
  process.exitCode=1;
}).finally(()=>prisma.$disconnect());
