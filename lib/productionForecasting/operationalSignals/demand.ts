import { z } from 'zod';
import { EASTERN_TIME_ZONE, getZonedDateTimeParts, isValidZonedDateTime, zonedDateTimeToUtc } from '../../dateTime';

/** Verified OPS Item Coverage contract. This is a current inventory signal,
 * independent of the existing historical outbound-demand forecast. */
export const CURRENT_DEMAND_SOURCE = 'OPS_OHLQ_ITEM_COVERAGE';
export const CURRENT_DEMAND_CALCULATION_VERSION = 'agency-min-v1';
export type AgencyWarehouse = 'GPT' | 'GRN' | 'UNASSIGNED';
export type CurrentDemandFailure = 'upstream-authentication' | 'upstream-unavailable' | 'invalid-response';
export type CurrentDemandSourceMetadata = {
  sourceUpdatedAt: string | null;
  sourceUpdatedAtOrigin: 'OPS_PRODUCTS_FOOTNOTE' | null;
  sourceFootnote: string | null;
  sourceUpdatedAtStatus: 'KNOWN' | 'MISSING' | 'UNPARSEABLE' | 'FUTURE' | 'CONFLICTING' | 'AMBIGUOUS';
};
export type CurrentDemandDownloadProduct =
  | ({ itemCode: string; status: 'ok'; observedAt: string; payload: unknown } & Partial<CurrentDemandSourceMetadata>)
  | { itemCode: string; status: 'failed'; observedAt: string; reason: CurrentDemandFailure };
export type CurrentDemandDownload = { products: CurrentDemandDownloadProduct[] };
export type DemandUnavailableReason = 'INVALID_RESPONSE' | 'INCOMPLETE_SOURCE' | 'SOURCE_INELIGIBLE' | 'MISSING_CASE_PACK' | 'MISSING_QUANTITY' | 'NEGATIVE_INVENTORY' | 'INVALID_QUANTITY' | 'CONFLICTING_AGENCY_ROWS';
export type AgencyDemandEvidence = {
  agencyNumber: string;
  warehouse: AgencyWarehouse;
  coverageGroup: 'MIN' | 'MANUAL' | 'RESTRICTED';
  minimumBottles: number | null;
  inventoryBottles: number | null;
  grossCases: number | null;
};
export type CurrentDemandEvidence = {
  source: typeof CURRENT_DEMAND_SOURCE;
  calculationVersion: typeof CURRENT_DEMAND_CALCULATION_VERSION;
  itemCode: string;
  requestPath: string;
  bottlesPerCase: number | null;
  sourceStatusCode: string | null;
  sourceDetailCode: string | null;
  rawRows: number;
  duplicateRows: number;
  declaredCounts: { minimum: number | null; manual: number | null; restricted: number | null };
  rows: AgencyDemandEvidence[];
  method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE';
  // User-approved morning estimate. Same-day shipments/scans may lag the snapshot.
  inboundStatus: 'NOT_RECONCILED';
  inventoryTiming: 'OVERNIGHT_SNAPSHOT_SAME_DAY_MOVEMENTS_MAY_LAG';
};
export type CurrentDemandResult =
  | { status: 'ok'; grossCases: number; inboundCases: null; demandCases: number; bottlesPerCase: number; agencyCount: number; byWarehouse: Record<AgencyWarehouse, number>; evidence: CurrentDemandEvidence }
  | { status: 'unavailable'; reason: DemandUnavailableReason; evidence: CurrentDemandEvidence };

/** Owner-confirmed store-prefix mapping. Unknown/A3A identities are not guessed. */
export function warehouseForAgency(agencyNumber: string): AgencyWarehouse {
  return /^[24]/.test(agencyNumber) ? 'GRN' : /^[135]/.test(agencyNumber) ? 'GPT' : 'UNASSIGNED';
}

/** The source clock is explicitly Eastern; native Date string parsing would
 * incorrectly depend on the host timezone. Unknown/ambiguous clocks stay null. */
export function parseItemCoverageFootnotes(footnotes: readonly string[], observedAt = new Date()): CurrentDemandSourceMetadata {
  const candidates = [...new Set(footnotes.map(text => text.replace(/\s+/g, ' ').trim()).filter(text => /^Item Coverage as of\b/.test(text)))];
  const raw = candidates.length === 1 && candidates[0].length <= 200 && /^[A-Za-z0-9 :,.()-]+$/.test(candidates[0]) ? candidates[0] : null;
  const unknown = (sourceUpdatedAtStatus: CurrentDemandSourceMetadata['sourceUpdatedAtStatus']): CurrentDemandSourceMetadata => ({ sourceUpdatedAt: null, sourceUpdatedAtOrigin: raw ? 'OPS_PRODUCTS_FOOTNOTE' : null, sourceFootnote: raw, sourceUpdatedAtStatus });
  if (!candidates.length) return unknown('MISSING');
  if (candidates.length !== 1) return unknown('CONFLICTING');
  if (!raw || !Number.isFinite(observedAt.getTime())) return unknown('UNPARSEABLE');
  const match = /^Item Coverage as of As of (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)\.$/.exec(raw);
  if (!match) return unknown('UNPARSEABLE');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[2]) + 1;
  const hour = Number(match[4]), minute = Number(match[5]);
  if (hour < 1 || hour > 12 || minute > 59) return unknown('UNPARSEABLE');
  const localDate = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const minutes = (hour % 12 + (match[6] === 'PM' ? 12 : 0)) * 60 + minute;
  if (!isValidZonedDateTime(localDate, minutes, EASTERN_TIME_ZONE)) return unknown('UNPARSEABLE');
  const parsed = zonedDateTimeToUtc(localDate, minutes, EASTERN_TIME_ZONE);
  // The portal omits a UTC offset. Do not invent one during a repeated DST hour.
  const sameClock = (date: Date) => {
    const parts = getZonedDateTimeParts(date, EASTERN_TIME_ZONE);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` === localDate && parts.hour * 60 + parts.minute === minutes;
  };
  if (sameClock(new Date(parsed.getTime() - 3600000)) || sameClock(new Date(parsed.getTime() + 3600000))) return unknown('AMBIGUOUS');
  if (parsed > observedAt) return unknown('FUTURE');
  return { sourceUpdatedAt: parsed.toISOString(), sourceUpdatedAtOrigin: 'OPS_PRODUCTS_FOOTNOTE', sourceFootnote: raw, sourceUpdatedAtStatus: 'KNOWN' };
}

function integer(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
const missing = (value: unknown) => value === null || value === undefined || value === '' || typeof value === 'string' && value.trim() === '';
const safeCode = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().toUpperCase() : '';
const plainMetadata = (value: unknown) => {
  const code = safeCode(value);
  return code && code.length <= 80 && /^[A-Z0-9 _-]+$/.test(code) ? code : null;
};
const sourceShape = z.object({ data: z.array(z.array(z.unknown()).length(16)).max(10000), productName: z.string().trim().min(1).max(500) });

/** Reach MIN, rounding whole cases separately at each MIN-covered agency.
 * All source counts must reconcile before even a zero is considered known. */
export function calculateCurrentDemand(itemCode: string, payload: unknown): CurrentDemandResult {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const bpc = integer(source.bpc);
  const counts = { minimum: integer(source.cntMin), manual: integer(source.cntManual), restricted: integer(source.cntRestricted) };
  const evidence: CurrentDemandEvidence = {
    source: CURRENT_DEMAND_SOURCE, calculationVersion: CURRENT_DEMAND_CALCULATION_VERSION,
    itemCode, requestPath: `/product/itemCoverage/${encodeURIComponent(itemCode)}`,
    bottlesPerCase: bpc && bpc > 0 ? bpc : null,
    sourceStatusCode: plainMetadata(source.statusCode), sourceDetailCode: plainMetadata(source.detailCode),
    rawRows: Array.isArray(source.data) ? source.data.length : 0, duplicateRows: 0, declaredCounts: counts, rows: [],
    method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE', inboundStatus: 'NOT_RECONCILED', inventoryTiming: 'OVERNIGHT_SNAPSHOT_SAME_DAY_MOVEMENTS_MAY_LAG',
  };
  const unavailable = (reason: DemandUnavailableReason): CurrentDemandResult => ({ status: 'unavailable', reason, evidence });
  // `inProcess` controls the portal's coverage-edit request UI. It does not
  // describe inventory publication or whether the returned data is complete.
  if (!Array.isArray(source.data)) return unavailable('INCOMPLETE_SOURCE');
  if (!sourceShape.safeParse(source).success) return unavailable('INVALID_RESPONSE');
  if (!evidence.sourceStatusCode || !evidence.sourceDetailCode) return unavailable('INVALID_RESPONSE');
  const detail = evidence.sourceDetailCode.replace('A-3A', 'A3A').replace(/\s+/g, ' ');
  if (evidence.sourceStatusCode === '30' || ['A3A DIST', 'A3A DISTILLERY ONLY'].includes(detail)) return unavailable('SOURCE_INELIGIBLE');
  if (Object.values(counts).some(n => n === null || n < 0) || counts.minimum! + counts.manual! + counts.restricted! !== source.data.length) return unavailable('INCOMPLETE_SOURCE');
  if (!bpc || bpc < 1) return unavailable('MISSING_CASE_PACK');
  const actualCounts = { MIN: 0, MANUAL: 0, RESTRICTED: 0 };
  const identities = new Map<string, string>();
  let quantityIssue: DemandUnavailableReason | null = null;
  for (const raw of source.data) {
    if (!Array.isArray(raw) || raw.length !== 16) return unavailable('INVALID_RESPONSE');
    const agencyNumber = safeCode(raw[0]), repeatedAgency = safeCode(raw[2]);
    const group = safeCode(raw[6]);
    if (!agencyNumber || !/^[A-Z0-9-]{1,32}$/.test(agencyNumber) || agencyNumber !== repeatedAgency || !['MIN', 'MANUAL', 'RESTRICTED'].includes(group)) return unavailable('INVALID_RESPONSE');
    const coverageGroup = group as AgencyDemandEvidence['coverageGroup'];
    actualCounts[coverageGroup]++;
    const identity = JSON.stringify(raw);
    const old = identities.get(agencyNumber);
    if (old !== undefined) {
      if (old !== identity) return unavailable('CONFLICTING_AGENCY_ROWS');
      evidence.duplicateRows++;
      continue;
    }
    identities.set(agencyNumber, identity);
    const minimumBottles = integer(raw[7]), inventoryBottles = integer(raw[9]);
    const row: AgencyDemandEvidence = { agencyNumber, warehouse: warehouseForAgency(agencyNumber), coverageGroup, minimumBottles, inventoryBottles, grossCases: null };
    if (coverageGroup === 'MIN') {
      if (missing(raw[7]) || missing(raw[9])) quantityIssue ??= 'MISSING_QUANTITY';
      else if (minimumBottles === null || inventoryBottles === null || minimumBottles < 0) quantityIssue ??= 'INVALID_QUANTITY';
      else if (inventoryBottles < 0) quantityIssue ??= 'NEGATIVE_INVENTORY';
      else {
        const gap = minimumBottles - inventoryBottles;
        if (!Number.isSafeInteger(gap)) quantityIssue ??= 'INVALID_QUANTITY';
        else row.grossCases = Math.max(0, Math.ceil(gap / bpc));
      }
    }
    evidence.rows.push(row);
  }
  if (actualCounts.MIN !== counts.minimum || actualCounts.MANUAL !== counts.manual || actualCounts.RESTRICTED !== counts.restricted) return unavailable('INCOMPLETE_SOURCE');
  if (quantityIssue) return unavailable(quantityIssue);
  const byWarehouse: Record<AgencyWarehouse, number> = { GPT: 0, GRN: 0, UNASSIGNED: 0 };
  let agencyCount = 0, grossCases = 0;
  for (const row of evidence.rows) if (row.coverageGroup === 'MIN') {
    agencyCount++;
    grossCases += row.grossCases!;
    byWarehouse[row.warehouse] += row.grossCases!;
  }
  if (!Number.isSafeInteger(grossCases) || grossCases > 9999999999) return unavailable('INVALID_QUANTITY');
  return { status: 'ok', grossCases, inboundCases: null, demandCases: grossCases, bottlesPerCase: bpc, agencyCount, byWarehouse, evidence };
}
