import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { OhlqSummaryNativeExport } from './ohlqAnnualSalesReport';

export const ECHO_SALES_REPORT_ID = '9781fc23-73de-4ee8-b0b8-77ae6f9b7c4e';
export const ECHO_SALES_VENDOR = 'Z90399001';
export type EchoSalesEvidence = { native: OhlqSummaryNativeExport; requestReference: string };
type Facts = { rowCount: number; retail: bigint; wholesale: bigint; hash: string };

export function validateEchoSalesEvidence(csv: Buffer | string, reportDate: string, evidence: EchoSalesEvidence) {
  const { native, requestReference } = evidence;
  const acquiredAt = new Date(native.acquiredAt);
  if (native.reportIdentity !== ECHO_SALES_REPORT_ID || native.requestedFrom !== reportDate ||
      native.requestedTo !== reportDate || native.exportCompleted !== true ||
      !['COMPLETE_STATEWIDE', 'VENDOR_FILTERED'].includes(native.scope) ||
      !Number.isFinite(acquiredAt.getTime()) || acquiredAt.getTime() > Date.now() ||
      !requestReference.trim() || requestReference.length > 500) {
    throw new Error('Missing verified statewide Annual Sales Summary evidence.');
  }
  const bytes = typeof csv === 'string' ? Uint8Array.from(Buffer.from(csv, 'utf8')) : Uint8Array.from(csv);
  if (!bytes.length) throw new Error('The complete native CSV bytes are required.');
  return { acquiredAt, requestReference, scope: native.scope, bytes: BigInt(bytes.length), hash: createHash('sha256').update(bytes).digest('hex') };
}

export async function lockEchoSalesDate(tx: Prisma.TransactionClient, reportDate: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(224906193, (${reportDate}::date - DATE '2000-01-01'))::text`;
}

export async function publishEchoSalesCoverage(
  tx: Prisma.TransactionClient,
  reportDate: string,
  rows: Prisma.OhlqAnnualSalesRowCreateManyInput[],
  evidence: ReturnType<typeof validateEchoSalesEvidence>,
) {
  const echo = rows.filter(row => row.vendor === ECHO_SALES_VENDOR).map(row => ({
    agencyId: row.agencyId, brand: row.brand,
    retailBottlesSold: row.retailBottlesSold, wholesaleBottlesSold: row.wholesaleBottlesSold,
  }));
  const fingerprint = (source: Prisma.Sql) => Prisma.sql`
    SELECT count(*)::integer AS "rowCount", coalesce(sum(r), 0)::bigint AS retail,
      coalesce(sum(w), 0)::bigint AS wholesale,
      encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(
        ${reportDate}::text, agency, ${ECHO_SALES_VENDOR}::text, brand, r, w
      ) ORDER BY agency COLLATE "C", brand COLLATE "C")::text, '[]'), 'UTF8')), 'hex') AS hash
    FROM (${source}) facts
  `;
  const [expected] = await tx.$queryRaw<Facts[]>(fingerprint(Prisma.sql`
    SELECT "agencyId" AS agency, brand, "retailBottlesSold" AS r, "wholesaleBottlesSold" AS w
    FROM jsonb_to_recordset(${JSON.stringify(echo)}::jsonb) AS x(
      "agencyId" text, brand text, "retailBottlesSold" integer, "wholesaleBottlesSold" integer)
  `));
  const [actual] = await tx.$queryRaw<Facts[]>(fingerprint(Prisma.sql`
    SELECT "agencyId" AS agency, brand, "retailBottlesSold" AS r, "wholesaleBottlesSold" AS w
    FROM public."OhlqAnnualSalesRow" WHERE "reportDate"=${reportDate}::date AND vendor=${ECHO_SALES_VENDOR}
  `));
  if (!expected || !actual || expected.hash !== actual.hash || expected.rowCount !== actual.rowCount ||
      expected.retail !== actual.retail || expected.wholesale !== actual.wholesale) {
    throw new Error('Persisted Echo sales do not match the validated source.');
  }
  const date = new Date(reportDate + 'T00:00:00Z');
  const prior = await tx.echoBottleSalesDayCoverage.findUnique({ where: { reportDate: date } });
  if (prior && (!prior.sourceAcquiredAt || prior.sourceAcquiredAt >= evidence.acquiredAt)) {
    if (prior.expectedFactsSha256 !== expected.hash) throw new Error('Stale or unordered conflicting Echo sales source.');
    if (prior.sourceAcquiredAt) return;
  }

  const values = {
    vendor: ECHO_SALES_VENDOR, sourceReportIdentity: ECHO_SALES_REPORT_ID, sourceScope: evidence.scope,
    requestedFrom: date, requestedTo: date, requestReference: evidence.requestReference,
    sourceContentSha256: evidence.hash, sourceByteLength: evidence.bytes, sourceRowCount: rows.length,
    sourceSkippedRows: 0, sourceExportCompleted: true, sourceAcquiredAt: evidence.acquiredAt,
    completedAt: new Date(), expectedRowCount: expected.rowCount, expectedRetailBottles: expected.retail,
    expectedWholesaleBottles: expected.wholesale, expectedFactsSha256: expected.hash,
  };
  await tx.echoBottleSalesDayCoverage.upsert({
    where: { reportDate: date }, create: { reportDate: date, ...values }, update: values,
  });
}
