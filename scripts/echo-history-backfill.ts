import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import Papa from 'papaparse';
import { prisma } from '../lib/prisma';
import { downloadOhlqEchoSalesPairs, type OhlqAnnualSalesDownloadResult } from '../lib/ohlqAnnualSalesReport';
import { importOhlqAnnualSalesCsv, parseOhlqAnnualSalesByWholesaleCsv } from '../lib/ohlqAnnualSalesImport';

const vendor = 'Z90399001';
const start = '2022-12-02';
const end = start;
const approvedPermitHash = '563ed9ef31476d1415999bf64d130406df8a8fc4d98e2c5a1c07d95c5c74e898';
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

function wholesaleRows(result: OhlqAnnualSalesDownloadResult, date: string, permit: string) {
  const e = result.echoWholesaleExport;
  if (!e || e.reportIdentity !== wholesaleId || e.date !== date || result.reportDate !== date) {
    throw Error('Invalid wholesale source evidence.');
  }
  if (e.verifiedEmpty || e.statewide || date !== start) throw Error('Expected the nonempty vendor filtered wholesale export.');
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
  if (!columns.includes('Wholesale_Bottles_Sold') || !columns.includes('Permit_Number')) {
    throw Error('Required wholesale columns are missing.');
  }
  if (input.data.some(row => !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(row.Wholesale_Bottles_Sold?.trim() ?? '') &&
      row.Wholesale_Bottles_Sold?.trim() !== '')) throw Error('Wholesale quantity syntax is invalid.');
  const missingPermit = input.data.filter(row => !row.Permit_Number?.trim());
  if (missingPermit.length !== 1 || missingPermit[0].DimVendor_VendorNumber_?.trim() !== vendor ||
      !missingPermit[0].Agency_Id?.trim() || !missingPermit[0].Brand?.trim()) {
    throw Error('The export does not contain one matching missing permit.');
  }
  missingPermit[0].Permit_Number = permit;
  const repaired = Papa.unparse(input.data, { columns });
  const parsed = parseOhlqAnnualSalesByWholesaleCsv(repaired, date);
  if (parsed.skippedRows) throw Error('Wholesale rows are missing key identifiers.');
  if (input.data.length !== parsed.rows.length) throw Error('Wholesale CSV has repeated row keys.');
  if (!e.statewide && parsed.rows.some(row => row.vendor !== vendor)) throw Error('Wholesale rows are outside the Echo scope.');
  if (parsed.rows.some(row => row.wholesaleBottlesSold! < -2147483648 || row.wholesaleBottlesSold! > 2147483647)) {
    throw Error('Wholesale quantity is outside the supported integer range.');
  }
  return { rows: parsed.rows, csvHash: sha(bytes) };
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
  return 'echo-pair:' + process.env.GITHUB_RUN_ID + ':' + actual.sha + ':' + input.csvHash + ':user-confirmed-permit-correction';
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
  const batch = (await remaining()).map(row => row.date);
  if (!batch.length) return;
  const permits = await prisma.$queryRaw<{ permit: string }[]>`
    SELECT DISTINCT "licenseeId" AS permit FROM "WholesaleLicenseeId"
    WHERE encode(sha256(convert_to("licenseeId",'UTF8')),'hex')=${approvedPermitHash}
  `;
  if (permits.length !== 1) throw Error('Could not validate the approved permit.');
  console.log(JSON.stringify({ from: start, missing: batch.length, singleDate: true }));
  let committed = 0;
  let attempts = 0;

  while (committed < batch.length) {
    day = batch[committed];
    stage = 'sign-in';
    report = undefined;
    try {
      await downloadOhlqEchoSalesPairs(batch.slice(committed), {
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
      }, async (summary, wholesale) => {
        stage = 'validate-summary-evidence';
        const info = summary.summaryNativeExport;
        if (!summary.csvBuffer || summary.csvBuffer.length !== summary.sizeBytes || !info || day !== summary.reportDate) {
          throw Error('Incomplete summary bytes.');
        }
        stage = 'validate-wholesale-source';
        const detail = wholesaleRows(wholesale, summary.reportDate, permits[0].permit);
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
        committed += 1;
        attempts = 0;
        console.log(JSON.stringify({ date: summary.reportDate, summary: result.importedRows, wholesale: detail.rows.length, committed: true }));
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TimeoutError' || ++attempts >= 3) throw error;
      console.log(JSON.stringify({ retrying: day, report, stage, attempt: attempts + 1 }));
      await delay(attempts * 15000);
    }
  }
  if ((await remaining()).length) throw Error('The corrected day did not reconcile.');
  console.log(JSON.stringify({ date: start, verifiedCorrection: true }));
}
main().catch((e:unknown)=>{
  const code=e && typeof e==='object' && 'code' in e && /^P\d{4}$/.test(String(e.code)) ? String(e.code):undefined;
  const message = e instanceof Error ? e.message : '';
  const safeErrors = [["Invalid wholesale bottle quantity","wholesale-quantity"],["Unable to parse OHLQ wholesale CSV","wholesale-csv"],["OHLQ wholesale CSV is missing","wholesale-headers"],["OHLQ wholesale CSV contains conflicting duplicate","wholesale-conflicting-keys"],["Unable to parse OHLQ CSV","summary-csv"],["OHLQ CSV is missing","summary-headers"],["Invalid signed integer in OHLQ sales summary","summary-quantity"],["Invalid integer value in OHLQ CSV","summary-quantity"]];
  const reason = /^[A-Za-z -]+\.$/.test(message) ? message : safeErrors.find(([prefix]) => message.startsWith(prefix))?.[1];
  console.error(JSON.stringify({day,report,stage,code,reason,timeout:e instanceof Error && e.name==='TimeoutError'}));
  process.exitCode=1;
}).finally(()=>prisma.$disconnect());
