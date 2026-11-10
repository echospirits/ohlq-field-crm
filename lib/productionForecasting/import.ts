import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { Prisma, type PrismaClient } from '@prisma/client';
import { classifications, dateOnly, includedInDemand, validDay, type Classification } from './model';
import { prisma } from '../prisma';
import { assertEchoOrganization } from '../echoAccess';
import { normalizeNativeOhio, ohioItemContext, type NativeOhioOptions } from './ohio';
import { reconcileDemandRows, scopeIdentity } from './reconciliation';

export type SourceKind = 'BAILMENT_PO_INVOICE' | 'DISTRIBUTION_CENTER';
export type ImportOptions = { organizationId: string; market: string; source: SourceKind; start: string; end: string; observedOn: string; complete: boolean; nativeHistory?: Pick<NativeOhioOptions, 'directInvoices' | 'fullPortfolio'> };
export type NormalizedRow = { itemCode: string; locationCode: string; locationName: string; classification: Classification; sourceLineId: string; date: string; availableOn: string; cases: number; status: string; minimum: number | null; maximum: number | null };
export type SourceScope = { itemCode: string; locationCode: string; locationName: string; classification: Classification };
export const SOURCE_HEADERS = {
  BAILMENT_PO_INVOICE: ['source_line_id', 'movement_date', 'available_on', 'item_code', 'location_code', 'location_name', 'classification', 'transaction_status', 'cases'],
  DISTRIBUTION_CENTER: ['item_code', 'location_code', 'location_name', 'classification', 'minimum_cases', 'maximum_cases'],
} as const;
// Source-native text mapping belongs only to the Ohio boundary. Explicit exact
// aliases protect against accidentally matching e.g. "not A3A Dist".
export function ohioClassification(value: string): Classification {
  const token = value.trim().toUpperCase().replace(/A-3A/g, 'A3A').replace(/\s+/g, ' ');
  const aliases: Record<string, Classification> = { 'A3A BAIL': 'A3A_BAIL', 'A3A BAILMENT': 'A3A_BAIL', 'A3A DIST': 'A3A_DIST', 'A3A DISTILLERY ONLY': 'A3A_DIST', ...Object.fromEntries(classifications.map(k => [k, k])) };
  const found = aliases[token];
  if (!found) throw new Error(`Unknown classification: ${value.slice(0, 80)}. Map the source value explicitly before import.`);
  return found;
}
const text = (value: string | undefined, field: string, optional = false) => {
  const result = (value ?? '').trim();
  if ((!optional && !result) || result.length > 200 || /[\x00-\x1f]/.test(result)) throw new Error(`Invalid ${field}.`);
  return result;
};
function quantity(value: string | undefined, field: string, optional = false) {
  if (optional && !(value ?? '').trim()) return null;
  const normalized = (value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) throw new Error(`${field} must be a nonnegative case quantity with at most 4 decimal places.`);
  const n = Number(normalized);
  if (!Number.isFinite(n) || n > 1e8) throw new Error(`Invalid ${field}.`);
  return n;
}
export function parseProductionSource(csv: string, options: ImportOptions) {
  if (!options.organizationId || options.market !== 'OH' || !['BAILMENT_PO_INVOICE', 'DISTRIBUTION_CENTER'].includes(options.source)) throw new Error('A valid organization and supported market/source are required.');
  if (![options.start, options.end, options.observedOn].every(validDay) || options.start > options.end || options.end > options.observedOn || options.observedOn > dateOnly(new Date())) throw new Error('Choose valid coverage dates and a report date through today.');
  if (!options.complete) throw new Error('Confirm the report is complete for every included product/location and the entire coverage period. Partial reports cannot establish zero demand.');
  if (Buffer.byteLength(csv, 'utf8') > 8 * 1024 * 1024) throw new Error('Use a CSV no larger than 8 MiB.');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: (h: string) => h.trim().replace(/^\uFEFF/, '') }) as { data: Record<string, string>[]; errors: unknown[]; meta: { fields?: string[] } };
  if (parsed.errors.length) throw new Error('CSV is malformed. Check delimiters, duplicate headers and row lengths.');
  const fields = parsed.meta.fields ?? [];
  const missing = SOURCE_HEADERS[options.source].filter(h => !fields.includes(h));
  if (missing.length) throw new Error(`Normalized CSV headers required: ${missing.join(', ')}. Native report mapping must be verified first.`);
  if (!parsed.data.length || parsed.data.length > 50000) throw new Error('A complete slice must contain 1–50,000 rows. Use an explicit zero row for a covered series with no demand.');
  const rows: NormalizedRow[] = [], ids = new Set<string>(), scopeMap = new Map<string, SourceScope>();
  let excludedRows = 0;
  for (const [index, r] of parsed.data.entries()) {
    try {
      const itemCode = text(r.item_code, 'item code').toUpperCase(), locationCode = text(r.location_code, 'location code').toUpperCase();
      const classification = ohioClassification(text(r.classification, 'classification'));
      const locationName = text(r.location_name, 'location name');
      const scopeKey = JSON.stringify([itemCode, locationCode]);
      const oldScope = scopeMap.get(scopeKey);
      if (oldScope && oldScope.classification !== classification) throw new Error('Conflicting classifications for the same product/location. Split or correct the source slice.');
      scopeMap.set(scopeKey, { itemCode, locationCode, locationName, classification });
      const row: NormalizedRow = { itemCode, locationCode, locationName, classification, sourceLineId: String(index), date: options.observedOn, availableOn: options.observedOn, cases: 0, status: 'POSTED', minimum: null, maximum: null };
      if (options.source === 'BAILMENT_PO_INVOICE') {
        row.sourceLineId = text(r.source_line_id, 'source line ID'); row.date = text(r.movement_date, 'movement date'); row.availableOn = text(r.available_on, 'source availability date');
        if (!validDay(row.date) || !validDay(row.availableOn) || row.date < options.start || row.date > options.end || row.availableOn < row.date || row.availableOn > options.observedOn) throw new Error('Movement/availability dates fall outside the declared source window.');
        row.status = text(r.transaction_status, 'transaction status').toUpperCase();
        if (!['POSTED', 'SHIPPED', 'CANCELLED', 'PENDING'].includes(row.status)) throw new Error('Map transaction status to POSTED, SHIPPED, CANCELLED or PENDING.');
        row.cases = quantity(r.cases, 'cases')!;
        // Require a finalized export. Pending shipments cannot establish complete
        // history; cancellations are explicit excluded source records.
        if (row.status === 'PENDING') throw new Error('Pending movement makes this slice incomplete. Import a finalized historical slice.');
      } else {
        row.minimum = quantity(r.minimum_cases, 'minimum cases', true); row.maximum = quantity(r.maximum_cases, 'maximum cases', true);
        if (row.minimum !== null && row.maximum !== null && row.minimum > row.maximum) throw new Error('Minimum guidance exceeds maximum guidance.');
      }
      const key = options.source === 'BAILMENT_PO_INVOICE' ? row.sourceLineId : scopeKey;
      if (ids.has(key)) throw new Error('Duplicate source line or guidance product/location. Resolve duplicates before import.');
      ids.add(key);
      if (!includedInDemand(classification) || row.status === 'CANCELLED') excludedRows++;
      rows.push(row);
    } catch (error) { throw new Error(`Row ${index + 2}: ${error instanceof Error ? error.message : 'Invalid source row.'}`); }
  }
  // Cancelled-only rows do not prove that a demand series is complete.
  const scopes = [...scopeMap.values()].filter(s => rows.some(r => r.itemCode === s.itemCode && r.locationCode === s.locationCode && r.status !== 'CANCELLED'));
  const hash = createHash('sha256').update(JSON.stringify({ ...options, rows })).digest('hex');
  return { rows, scopes, excludedRows, hash };
}
type Db = PrismaClient | Prisma.TransactionClient;
export async function forecastAccess(db: Db, organizationId: string) {
  assertEchoOrganization(organizationId);
  const organization = await db.organization.findFirst({ where: { id: organizationId, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, features: { some: { featureKey: 'PRODUCTION_FORECASTING', enabled: true } } }, select: { id: true, enabledStates: true, settings: true, timezone: true } });
  if (!organization) throw new Error('Production Forecasting is unavailable for this organization.');
  return organization;
}
export async function importProductionSource(csv: string, options: ImportOptions, db: PrismaClient = prisma) {
  if (Buffer.byteLength(csv, 'utf8') > 8 * 1024 * 1024) throw new Error('Choose a CSV/TSV no larger than 8 MiB.');
  try { return await db.$transaction(async tx => {
    // Serialize imports and refreshes per tenant, without blocking other tenants.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-forecast:${options.organizationId}`}))`;
    const organization = await forecastAccess(tx, options.organizationId);
    if (!organization.enabledStates.includes(options.market)) throw new Error('This market is not enabled for the organization.');
    const context = await ohioItemContext(tx, options.organizationId);
    const native = normalizeNativeOhio(csv, options.source, context, options.nativeHistory ? { ...options.nativeHistory, start: options.start, end: options.end } : undefined);
    if (options.nativeHistory && !native) throw new Error('Automatic reconciliation requires a recognized native Ohio report.');
    const parsed = parseProductionSource(native?.csv ?? csv, options);
    const allowed = context.included;
    if (parsed.rows.some(r => !allowed.has(r.itemCode))) throw new Error('Every item must be an eligible Production Forecasting item or an active owned or represented Organization product. No unrelated items were imported.');
    // Composite source/snapshot FKs reuse product identities. Create missing
    // vendor-bailment identities without enrolling them in sales or inventory;
    // skipDuplicates never changes an existing portfolio decision.
    if (context.forecastProducts?.length) await tx.organizationProduct.createMany({ data: context.forecastProducts.map(p => ({ organizationId: options.organizationId, market: 'OH', externalItemCode: p.itemCode, displayName: p.itemName, status: 'EXCLUDED' as const, active: false })), skipDuplicates: true });
    // A manually normalized classification cannot override known item exclusion.
    for (const row of parsed.rows) if (context.distilleryOnly.has(row.itemCode)) row.classification = 'A3A_DIST';
    for (const scope of parsed.scopes) if (context.distilleryOnly.has(scope.itemCode)) scope.classification = 'A3A_DIST';
    parsed.excludedRows = parsed.rows.filter(r => !includedInDemand(r.classification) || r.status === 'CANCELLED').length;
    const prior = await tx.productionSourceImport.findUnique({ where: { organizationId_market_source_contentHash: { organizationId: options.organizationId, market: options.market, source: options.source, contentHash: parsed.hash } } });
    if (prior) return { id: prior.id, replay: true, rowCount: prior.rowCount, excludedRows: prior.excludedRows };
    let revision: ReturnType<typeof reconcileDemandRows> | null = null;
    if (options.source === 'BAILMENT_PO_INVOICE') {
      const overlaps = await tx.productionSourceImport.findMany({ where: { organizationId: options.organizationId, market: options.market, source: options.source, status: 'COMPLETE', coverageStart: { lte: new Date(options.end) }, coverageEnd: { gte: new Date(options.start) } }, select: { summary: true, coverageStart: true, coverageEnd: true } });
      const incoming = new Set(parsed.scopes.map(s => JSON.stringify([s.itemCode, s.locationCode])));
      if (native && options.nativeHistory?.fullPortfolio) {
        // A full provider export revises facts in its declared interval only.
        // Old rows and forecast snapshots remain immutable audit evidence.
        const previous = await tx.productionDemandObservation.findMany({ where: { organizationId: options.organizationId, market: options.market, itemCode: { in: [...allowed] }, date: { gte: new Date(options.start), lte: new Date(options.end) }, sourceImport: { status: 'COMPLETE' } }, select: { id: true, sourceLineId: true, date: true, availableOn: true, cases: true, itemCode: true, locationCode: true, locationName: true, classification: true, transactionStatus: true, sourceImport: { select: { importedAt: true } } } });
        const priorCoverage = new Map<string, string>();
        for (const overlap of overlaps) for (const scope of (overlap.summary as unknown as { scopes: SourceScope[] }).scopes) {
          const key = scopeIdentity(scope), end = dateOnly(overlap.coverageEnd);
          if (end > (priorCoverage.get(key) ?? '')) priorCoverage.set(key, end);
          // Preserve known fulfillment scopes even if a corrected full report
          // no longer contains any movements at that location.
          if (allowed.has(scope.itemCode) && !incoming.has(key)) { parsed.scopes.push(scope); incoming.add(key); }
        }
        revision = reconcileDemandRows(parsed.rows, previous.map(r => ({ ...r, date: dateOnly(r.date), availableOn: dateOnly(r.availableOn), cases: Number(r.cases), classification: r.classification as Classification, status: r.transactionStatus, versionAt: r.sourceImport.importedAt.toISOString() })), priorCoverage, options.observedOn);
      } else for (const overlap of overlaps) {
        const summary = overlap.summary as unknown as { scopes: SourceScope[] };
        if (summary.scopes.some(s => incoming.has(JSON.stringify([s.itemCode, s.locationCode])))) throw new Error('This product/location already has an immutable demand slice in this period. Upload a non-overlapping period; corrections require an audited source revision.');
      }
    }
    const batch = await tx.productionSourceImport.create({ data: { organizationId: options.organizationId, market: options.market, source: options.source, status: 'COMPLETE', contentHash: parsed.hash, coverageStart: new Date(options.start), coverageEnd: new Date(options.end), observedOn: new Date(options.observedOn), rowCount: parsed.rows.length, excludedRows: parsed.excludedRows, summary: { scopes: parsed.scopes, adapterVersion: native?.adapterVersion ?? 'normalized-ohio-v1', outsidePortfolioRows: native?.outOfScopeRows ?? 0, outsideWindowRows: native?.outsideWindowRows ?? 0, directRows: native?.directRows ?? 0, unshippedRows: native?.unshippedRows ?? 0, directInvoicePolicy: options.nativeHistory?.directInvoices ?? null, completenessConfirmed: true, revisions: revision ? { added: revision.added, changed: revision.changed, removed: revision.removed, unchanged: revision.unchanged } : null } as Prisma.InputJsonValue } });
    const writes = revision?.writes ?? parsed.rows.map(row => ({ row, originalSourceLineId: row.sourceLineId, previousObservationId: null, removed: false }));
    // Bounded writes avoid oversized PostgreSQL bind-parameter statements.
    for (let offset = 0; offset < writes.length; offset += 1000) {
      const chunk = writes.slice(offset, offset + 1000).map(w => w.row);
      if (options.source === 'BAILMENT_PO_INVOICE') await tx.productionDemandObservation.createMany({ data: writes.slice(offset, offset + 1000).map(w => { const r = w.row; return { organizationId: options.organizationId, importId: batch.id, market: options.market, itemCode: r.itemCode, locationCode: r.locationCode, locationName: r.locationName, sourceLineId: r.sourceLineId, date: new Date(r.date), availableOn: new Date(r.availableOn), cases: r.cases, classification: r.classification, transactionStatus: r.status, sourceEvidence: native ? { original: w.originalSourceLineId ? native.evidence.get(w.originalSourceLineId) ?? null : null, previousObservationId: w.previousObservationId, removed: w.removed } : Prisma.JsonNull }; }) });
      else await tx.productionGuidanceObservation.createMany({ data: chunk.map(r => ({ organizationId: options.organizationId, importId: batch.id, market: options.market, itemCode: r.itemCode, locationCode: r.locationCode, locationName: r.locationName, observedOn: new Date(options.observedOn), minimum: r.minimum, maximum: r.maximum, classification: r.classification, sourceEvidence: native?.evidence.get(JSON.stringify([r.itemCode, r.locationCode])) ?? Prisma.JsonNull })) });
    }
    return { id: batch.id, replay: false, rowCount: parsed.rows.length, excludedRows: parsed.excludedRows };
  }, { timeout: 60000 }); }
  catch (error) {
    // Retain only safe failure metadata. A rejected/partial file never creates
    // demand facts or coverage, and cannot make old forecasts appear current.
    if (options.market === 'OH' && ['BAILMENT_PO_INVOICE', 'DISTRIBUTION_CENTER'].includes(options.source) && [options.start, options.end, options.observedOn].every(validDay) && options.start <= options.end && options.end <= options.observedOn && options.observedOn <= dateOnly(new Date())) {
      await (async () => {
        const organization = await forecastAccess(db, options.organizationId);
        if (!organization.enabledStates.includes(options.market)) return;
        const hash = createHash('sha256').update(JSON.stringify(options)).update(csv).digest('hex');
        await db.productionSourceImport.upsert({ where: { organizationId_market_source_contentHash: { organizationId: options.organizationId, market: options.market, source: options.source, contentHash: hash } }, create: { organizationId: options.organizationId, market: options.market, source: options.source, contentHash: hash, status: options.complete ? 'FAILED' : 'INCOMPLETE', coverageStart: new Date(options.start), coverageEnd: new Date(options.end), observedOn: new Date(options.observedOn), summary: { issue: 'Source rejected; no observations or coverage were saved.' } }, update: {} });
      })().catch(() => undefined);
    }
    throw error;
  }
}
