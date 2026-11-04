import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../prisma';
import { formatDateInputValue } from '../../dateTime';
import { forecastAccess } from '../import';
import { configuredProducts } from '../service';
import { validDay } from '../model';
import { calculateCurrentDemand, parseItemCoverageFootnotes, type CurrentDemandDownload, type CurrentDemandDownloadProduct, type CurrentDemandSourceMetadata } from './demand';

type Db = PrismaClient | Prisma.TransactionClient;
export type CurrentDemandIngestionItem = {
  productId: string;
  itemCode: string;
  status: 'available' | 'unavailable' | 'failed' | 'reused';
  reason: string | null;
  observationId: string | null;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Rechecks the existing pilot/tenant and current portfolio before any fetch. */
export async function currentDemandProducts(organizationId: string, db: Db = prisma) {
  const organization = await forecastAccess(db, organizationId);
  return organization.enabledStates.includes('OH') ? configuredProducts(db, organizationId, ['OH']) : [];
}

/** Append-only daily good source observations; failed/partial attempts have
 * separate check state and never replace earlier successful source evidence. */
export async function ingestCurrentDemand({ organizationId, businessDate, download, db = prisma, now = new Date() }: {
  organizationId: string;
  businessDate: string;
  download: CurrentDemandDownload;
  db?: PrismaClient;
  now?: Date;
}) {
  if (!validDay(businessDate) || !Number.isFinite(now.getTime())) throw new Error('A valid current demand business date and check time are required.');
  const products = await currentDemandProducts(organizationId, db);
  const organization = await forecastAccess(db, organizationId);
  if (businessDate !== formatDateInputValue(now, organization.timezone)) throw new Error('Current demand observations must use the organization business date.');
  const incoming = new Map<string, CurrentDemandDownloadProduct>();
  const duplicateCodes = new Set<string>();
  for (const result of download.products) {
    if (incoming.has(result.itemCode)) duplicateCodes.add(result.itemCode);
    incoming.set(result.itemCode, result);
  }
  const results: CurrentDemandIngestionItem[] = [];
  for (const product of products) {
    const base = { productId: product.id, itemCode: product.code };
    try {
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`current-demand:${organizationId}:${product.id}:${businessDate}`}))`;
        // Portfolio and entitlement changes cannot be bypassed by a stale caller.
        await forecastAccess(tx, organizationId);
        const allowed = await tx.organizationProduct.findFirst({ where: { organizationId, id: product.id, market: 'OH', active: true, discontinued: false, status: { in: ['OWNED', 'REPRESENTED'] } }, select: { id: true } });
        if (!allowed) return { ...base, status: 'unavailable' as const, reason: 'PRODUCT_INELIGIBLE', observationId: null };
        const key = { organizationId, productId: product.id, businessDate: new Date(businessDate) };
        const existing = await tx.currentDemandObservation.findUnique({ where: { organizationId_productId_businessDate: key }, select: { id: true } });
        if (existing) return { ...base, status: 'reused' as const, reason: null, observationId: existing.id };
        const source = incoming.get(product.code);
        let checkedAt = now;
        const sourceTime = source ? new Date(source.observedAt) : null;
        if (sourceTime && Number.isFinite(sourceTime.getTime())) checkedAt = sourceTime;
        const saveCheck = async (status: 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED', reason: string | null, evidence?: unknown, observationId?: string) => {
          const data = { checkedAt, status, reason, observationId: observationId ?? null, evidence: evidence ? json(evidence) : Prisma.DbNull };
          await tx.currentDemandCheck.upsert({ where: { organizationId_productId_businessDate: key }, create: { ...key, ...data }, update: data });
        };
        if (!source || source.status === 'failed' || duplicateCodes.has(product.code) || !sourceTime || !Number.isFinite(sourceTime.getTime()) || formatDateInputValue(sourceTime, organization.timezone) !== businessDate) {
          const reason = duplicateCodes.has(product.code) ? 'DUPLICATE_PRODUCT_RESPONSE' : source?.status === 'failed' ? source.reason : 'INVALID_RESPONSE';
          await saveCheck('FAILED', reason);
          return { ...base, status: 'failed' as const, reason, observationId: null };
        }
        const sourceMetadata = parseItemCoverageFootnotes(source.sourceFootnote ? [source.sourceFootnote] : [], sourceTime);
        const calculated = calculateCurrentDemand(product.code, source.payload);
        if (calculated.status === 'unavailable') {
          await saveCheck('UNAVAILABLE', calculated.reason, { ...calculated.evidence, ...sourceMetadata });
          return { ...base, status: 'unavailable' as const, reason: calculated.reason, observationId: null };
        }
        if (sourceMetadata.sourceUpdatedAt && formatDateInputValue(new Date(sourceMetadata.sourceUpdatedAt), organization.timezone) < businessDate) {
          // A delayed overnight publication is retryable. Saving a successful
          // daily fact here would prevent later same-day recovery by design.
          await saveCheck('UNAVAILABLE', 'STALE_SOURCE', { ...calculated.evidence, ...sourceMetadata });
          return { ...base, status: 'unavailable' as const, reason: 'STALE_SOURCE', observationId: null };
        }
        // Reparse retained portal metadata at persistence, validating its clock
        // against retrieval time. Source JSON's R14Date is never a substitute.
        const observation = await tx.currentDemandObservation.create({ data: {
          ...key, market: product.market, itemCode: product.code,
          sourceObservedAt: sourceTime, sourceUpdatedAt: sourceMetadata.sourceUpdatedAt ? new Date(sourceMetadata.sourceUpdatedAt) : null,
          grossCases: calculated.grossCases, inboundCases: null, demandCases: calculated.demandCases, cases: calculated.demandCases,
          bottlesPerCase: calculated.bottlesPerCase, agencyCount: calculated.agencyCount,
          summary: json({ byWarehouse: calculated.byWarehouse, ...sourceMetadata }),
          evidence: json({ ...calculated.evidence, byWarehouse: calculated.byWarehouse, ...sourceMetadata }),
        }, select: { id: true } });
        await saveCheck('AVAILABLE', null, undefined, observation.id);
        return { ...base, status: 'available' as const, reason: null, observationId: observation.id };
      }, { timeout: 30000 });
      results.push(result);
    } catch {
      // The next product remains independent; provider/DB error strings are never metadata.
      results.push({ ...base, status: 'failed', reason: 'PERSISTENCE_FAILED', observationId: null });
    }
  }
  return {
    results,
    available: results.filter(r => r.status === 'available').length,
    unavailable: results.filter(r => r.status === 'unavailable').length,
    failed: results.filter(r => r.status === 'failed').length,
    reused: results.filter(r => r.status === 'reused').length,
  };
}

export type CurrentDemandSignal = {
  productId: string;
  itemCode: string;
  productName: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED' | 'PENDING';
  reason: string | null;
  businessDate: string | null;
  grossCases: number | null;
  demandCases: number | null;
  inboundCases: number | null;
  bottlesPerCase: number | null;
  agencyCount: number | null;
  byWarehouse: { GPT: number | null; GRN: number | null; UNASSIGNED: number | null };
  sourceObservedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceUpdatedAtOrigin: CurrentDemandSourceMetadata['sourceUpdatedAtOrigin'];
  sourceUpdatedAtStatus: CurrentDemandSourceMetadata['sourceUpdatedAtStatus'];
  observedAgeMinutes: number | null;
  sourceAgeMinutes: number | null;
  sourceFreshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
  checkedAt: string | null;
  checkDate: string | null;
  stale: boolean;
  retained: boolean;
  method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE';
};
const day = (value: Date) => value.toISOString().slice(0, 10);
const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
type DemandSummary = { byWarehouse?: { GPT?: unknown; GRN?: unknown; UNASSIGNED?: unknown }; sourceUpdatedAtOrigin?: CurrentDemandSourceMetadata['sourceUpdatedAtOrigin']; sourceUpdatedAtStatus?: CurrentDemandSourceMetadata['sourceUpdatedAtStatus'] };

function freshness(businessDate: string | null, observedAt: Date | null, sourceUpdatedAt: Date | null, today: string, timezone: string, now: Date) {
  const observedValid = observedAt !== null && Number.isFinite(observedAt.getTime()) && observedAt <= now;
  const sourceValid = sourceUpdatedAt !== null && Number.isFinite(sourceUpdatedAt.getTime()) && observedValid && sourceUpdatedAt <= observedAt!;
  const observedStale = !observedValid || businessDate !== today || formatDateInputValue(observedAt!, timezone) !== today;
  const sourceFreshness = !sourceValid ? 'UNKNOWN' as const : formatDateInputValue(sourceUpdatedAt!, timezone) === today ? 'CURRENT' as const : 'STALE' as const;
  return {
    observedAgeMinutes: observedValid ? Math.floor((now.getTime() - observedAt!.getTime()) / 60000) : null,
    sourceAgeMinutes: sourceValid ? Math.floor((now.getTime() - sourceUpdatedAt!.getTime()) / 60000) : null,
    sourceFreshness,
    stale: observedStale || sourceFreshness === 'STALE' || Boolean(sourceUpdatedAt && !sourceValid),
  };
}

/** Dashboard reads only precomputed product observations/checks, never source
 * rows or statistical forecast detail. Current portfolio exclusions apply first. */
export async function getCurrentDemandSignals(organizationId: string, db: PrismaClient = prisma, now = new Date()) {
  const organization = await forecastAccess(db, organizationId);
  const today = formatDateInputValue(now, organization.timezone);
  const products = organization.enabledStates.includes('OH') ? await configuredProducts(db, organizationId, ['OH']) : [];
  const productIds = products.map(p => p.id);
  const [observations, checks] = productIds.length ? await Promise.all([
    db.currentDemandObservation.findMany({ where: { organizationId, productId: { in: productIds } }, distinct: ['productId'], orderBy: [{ businessDate: 'desc' }, { sourceObservedAt: 'desc' }], select: { productId: true, businessDate: true, grossCases: true, demandCases: true, inboundCases: true, bottlesPerCase: true, agencyCount: true, summary: true, sourceObservedAt: true, sourceUpdatedAt: true } }),
    db.currentDemandCheck.findMany({ where: { organizationId, productId: { in: productIds } }, distinct: ['productId'], orderBy: [{ businessDate: 'desc' }, { checkedAt: 'desc' }], select: { productId: true, businessDate: true, checkedAt: true, status: true, reason: true } }),
  ]) : [[], []];
  const observationByProduct = new Map(observations.map(row => [row.productId, row]));
  const checkByProduct = new Map(checks.map(row => [row.productId, row]));
  const rows: CurrentDemandSignal[] = products.map(product => {
    const observation = observationByProduct.get(product.id), check = checkByProduct.get(product.id);
    const businessDate = observation ? day(observation.businessDate) : null;
    const checkDate = check ? day(check.businessDate) : null;
    const effectiveCheck = check && (!businessDate || checkDate! >= businessDate) ? check : null;
    const checkedStatus = effectiveCheck?.status ?? (observation ? 'AVAILABLE' : 'PENDING');
    const status = (['AVAILABLE', 'UNAVAILABLE', 'FAILED', 'PENDING'] as const).find(s => s === checkedStatus) ?? 'UNAVAILABLE';
    const summary = observation?.summary as DemandSummary | null | undefined;
    const age = freshness(businessDate, observation?.sourceObservedAt ?? null, observation?.sourceUpdatedAt ?? null, today, organization.timezone, now);
    return {
      productId: product.id, itemCode: product.code, productName: product.name,
      status, reason: effectiveCheck?.reason ?? null, businessDate,
      grossCases: nullableNumber(observation?.grossCases), demandCases: nullableNumber(observation?.demandCases), inboundCases: nullableNumber(observation?.inboundCases),
      bottlesPerCase: observation?.bottlesPerCase ?? null, agencyCount: observation?.agencyCount ?? null,
      byWarehouse: { GPT: nullableNumber(summary?.byWarehouse?.GPT), GRN: nullableNumber(summary?.byWarehouse?.GRN), UNASSIGNED: nullableNumber(summary?.byWarehouse?.UNASSIGNED) },
      sourceObservedAt: observation?.sourceObservedAt.toISOString() ?? null,
      sourceUpdatedAt: observation?.sourceUpdatedAt?.toISOString() ?? null,
      sourceUpdatedAtOrigin: summary?.sourceUpdatedAtOrigin ?? null,
      sourceUpdatedAtStatus: summary?.sourceUpdatedAtStatus ?? 'MISSING',
      ...age,
      checkedAt: check?.checkedAt.toISOString() ?? null, checkDate,
      retained: Boolean(observation && (status !== 'AVAILABLE' || age.stale)),
      method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE',
    };
  });
  return { today, rows };
}

export async function getCurrentDemandHistory(organizationId: string, productId: string, db: PrismaClient = prisma, limit = 30) {
  const products = await currentDemandProducts(organizationId, db);
  if (!products.some(product => product.id === productId)) return [];
  const take = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 90)) : 30;
  const observations = await db.currentDemandObservation.findMany({ where: { organizationId, productId }, take, orderBy: [{ businessDate: 'desc' }, { sourceObservedAt: 'desc' }], select: { id: true, businessDate: true, grossCases: true, demandCases: true, inboundCases: true, summary: true, sourceObservedAt: true, sourceUpdatedAt: true } });
  return observations.map(observation => {
    const summary = observation.summary as DemandSummary | null;
    return {
      id: observation.id, businessDate: day(observation.businessDate),
      grossCases: nullableNumber(observation.grossCases), demandCases: nullableNumber(observation.demandCases), inboundCases: nullableNumber(observation.inboundCases),
      byWarehouse: { GPT: nullableNumber(summary?.byWarehouse?.GPT), GRN: nullableNumber(summary?.byWarehouse?.GRN), UNASSIGNED: nullableNumber(summary?.byWarehouse?.UNASSIGNED) },
      sourceObservedAt: observation.sourceObservedAt.toISOString(), sourceUpdatedAt: observation.sourceUpdatedAt?.toISOString() ?? null,
      sourceUpdatedAtOrigin: summary?.sourceUpdatedAtOrigin ?? null, sourceUpdatedAtStatus: summary?.sourceUpdatedAtStatus ?? 'MISSING',
      method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE' as const,
    };
  });
}
