import { createHash } from 'node:crypto';
import { Prisma, type CurrentDcInventoryCheck, type CurrentDcInventoryObservation, type PrismaClient } from '@prisma/client';
import { prisma } from '../../prisma';
import { formatDateInputValue } from '../../dateTime';
import { forecastAccess } from '../import';
import { configuredProducts } from '../service';
import { validDay, type ForecastProduct } from '../model';
import { DC_INVENTORY_ADAPTER_VERSION, DC_INVENTORY_REPORT_ID, DC_INVENTORY_SOURCE, dcWarehouses, parseDcInventoryCsv, type DcInventoryDownload, type DcWarehouse } from './dcInventory';

type Db = PrismaClient | Prisma.TransactionClient;
type InventoryStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED' | 'PENDING';
export type CurrentDcInventoryWarehouseSignal = {
  inventoryCases: number | null; quantityCases: number | null; pickedCases: number | null;
  businessDate: string | null; sourceBusinessDate: string | null;
  sourceObservedAt: string | null; sourceUpdatedAt: string | null;
  status: InventoryStatus; stale: boolean; retained: boolean; reason: string | null;
  checkedAt: string | null;
};
export type CurrentDcInventorySignal = {
  productId: string; itemCode: string; productName: string;
  byWarehouse: Record<DcWarehouse, number | null>;
  warehouses: Record<DcWarehouse, CurrentDcInventoryWarehouseSignal>;
  sourceBusinessDate: string | null; sourceObservedAt: string | null; sourceUpdatedAt: string | null;
  status: InventoryStatus; stale: boolean; retained: boolean; reason: string | null;
};
export type DcInventoryIngestionItem = { productId: string; itemCode: string; locationCode: DcWarehouse; status: 'available' | 'unavailable' | 'failed' | 'reused'; reason: string | null; observationId: string | null };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const pair = (productId: string, locationCode: string) => JSON.stringify([productId, locationCode]);
const day = (date: Date) => date.toISOString().slice(0, 10);
const number = (value: unknown) => value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;

/** Daily work reuses accepted facts; explicit refreshes append newer retrievals.
 * Failed attempts never replace them. The caller supplies only a native export,
 * never trusted product IDs or totals. */
export async function ingestDcInventory({ organizationId, businessDate, download, refresh = false, db = prisma, now = new Date() }: { organizationId: string; businessDate: string; download: DcInventoryDownload; refresh?: boolean; db?: PrismaClient; now?: Date }) {
  if (!validDay(businessDate) || !Number.isFinite(now.getTime())) throw new Error('A valid inventory business date and check time are required.');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dc-inventory:${organizationId}:${businessDate}`}))`;
    const organization = await forecastAccess(tx, organizationId);
    if (!organization.enabledStates.includes('OH') || formatDateInputValue(now, organization.timezone) !== businessDate) throw new Error('Ohio inventory observations must use the organization business date.');
    const products = await configuredProducts(tx, organizationId, ['OH']);
    const vendors = await tx.organizationVendorIdentifier.findMany({ where: { organizationId, market: 'OH', active: true }, select: { vendorId: true } });
    const observedAt = new Date(download.observedAt);
    const validObservedAt = Number.isFinite(observedAt.getTime()) && observedAt <= now && formatDateInputValue(observedAt, organization.timezone) === businessDate;
    let failure: string | null = !validObservedAt ? 'INVALID_RESPONSE' : download.status === 'failed' ? download.reason : download.reportDate !== businessDate ? 'INVALID_RESPONSE' : null;
    let parsed: ReturnType<typeof parseDcInventoryCsv> | null = null;
    if (!failure && download.status === 'ok') {
      try { parsed = parseDcInventoryCsv(download.csv, { businessDate, vendorIds: vendors.map(v => v.vendorId), itemCodes: products.map(p => p.code) }); }
      catch { failure = 'INVALID_RESPONSE'; }
    }
    const parsedProducts = new Map(parsed?.products.map(product => [product.itemCode, product]));
    const productIds = products.map(product => product.id);
    const where = { organizationId, productId: { in: productIds }, businessDate: new Date(businessDate), locationCode: { in: [...dcWarehouses] } };
    const [existingRows, checks] = productIds.length ? await Promise.all([
      tx.currentDcInventoryObservation.findMany({ where, orderBy: [{ sourceObservedAt: 'desc' }, { id: 'desc' }], select: { id: true, productId: true, locationCode: true, sourceObservedAt: true } }),
      tx.currentDcInventoryCheck.findMany({ where, select: { productId: true, locationCode: true, checkedAt: true, status: true, reason: true, observationId: true } }),
    ]) : [[], []];
    const existing = new Map<string, typeof existingRows[number]>();
    for (const row of existingRows) if (!existing.has(pair(row.productId, row.locationCode))) existing.set(pair(row.productId, row.locationCode), row);
    const previousChecks = new Map(checks.map(row => [pair(row.productId, row.locationCode), row]));
    const checkedAt = validObservedAt ? observedAt : now;
    const contentHash = download.status === 'ok' ? createHash('sha256').update(download.csv).digest('hex') : null;
    const results: DcInventoryIngestionItem[] = [];
    for (const product of products) for (const locationCode of dcWarehouses) {
      const base = { productId: product.id, itemCode: product.code, locationCode };
      const key = { organizationId, productId: product.id, locationCode, businessDate: new Date(businessDate) };
      const old = existing.get(pair(product.id, locationCode)), previousCheck = previousChecks.get(pair(product.id, locationCode));
      if (previousCheck && previousCheck.checkedAt > checkedAt) {
        results.push({ ...base, status: old ? 'reused' : previousCheck.status === 'FAILED' ? 'failed' : 'unavailable', reason: previousCheck.reason, observationId: old?.id ?? null });
        continue;
      }
      // A retry of the same retrieval instant or a delayed older export cannot
      // append a duplicate fact or rewrite the latest check. Daily failure and
      // recovery checks retain their existing behavior.
      if (validObservedAt && old && (old.sourceObservedAt > observedAt || refresh && old.sourceObservedAt.getTime() === observedAt.getTime())) {
        results.push({ ...base, status: 'reused', reason: previousCheck?.reason ?? null, observationId: old.id });
        continue;
      }
      const source = parsedProducts.get(product.code), warehouse = source?.warehouses[locationCode];
      const reason = failure ?? warehouse?.reason ?? (!source ? 'MISSING_PRODUCT' : null);
      const evidence = source ? { ...source.evidence, contentHash, locationCode, rawRows: parsed!.rawRows, duplicateRows: parsed!.duplicateRows } : { source: DC_INVENTORY_SOURCE, reportId: DC_INVENTORY_REPORT_ID, contentHash };
      const saveCheck = async (status: 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED', observationId: string | null) => {
        const data = { checkedAt, status, reason, evidence: json(evidence), observationId };
        await tx.currentDcInventoryCheck.upsert({ where: { organizationId_productId_locationCode_businessDate: key }, create: { ...key, ...data }, update: data });
      };
      if (reason || !warehouse || warehouse.inventoryCases === null || warehouse.quantityCases === null || warehouse.pickedCases === null) {
        const status = failure ? 'FAILED' : 'UNAVAILABLE';
        await saveCheck(status, old?.id ?? null);
        results.push({ ...base, status: failure ? 'failed' : 'unavailable', reason: reason ?? 'INVALID_RESPONSE', observationId: old?.id ?? null });
        continue;
      }
      if (old && !refresh) {
        await saveCheck('AVAILABLE', old.id);
        results.push({ ...base, status: 'reused', reason: null, observationId: old.id });
        continue;
      }
      const observation = await tx.currentDcInventoryObservation.create({ data: {
        ...key, market: 'OH', itemCode: product.code, sourceBusinessDate: new Date(source!.sourceBusinessDate!),
        sourceObservedAt: observedAt, sourceUpdatedAt: null, source: DC_INVENTORY_SOURCE,
        reportId: DC_INVENTORY_REPORT_ID, adapterVersion: DC_INVENTORY_ADAPTER_VERSION,
        quantityCases: warehouse.quantityCases, pickedCases: warehouse.pickedCases, inventoryCases: warehouse.inventoryCases,
        evidence: json(evidence),
      }, select: { id: true } });
      await saveCheck('AVAILABLE', observation.id);
      results.push({ ...base, status: 'available', reason: null, observationId: observation.id });
    }
    return { results, available: results.filter(row => row.status === 'available').length, unavailable: results.filter(row => row.status === 'unavailable').length, failed: results.filter(row => row.status === 'failed').length, reused: results.filter(row => row.status === 'reused').length };
  }, { timeout: 60000 });
}

export async function dcInventoryAlreadyObservedToday(organizationId: string, db: Db = prisma, now = new Date()) {
  const organization = await forecastAccess(db, organizationId);
  if (!organization.enabledStates.includes('OH')) return false;
  const products = await configuredProducts(db, organizationId, ['OH']), today = formatDateInputValue(now, organization.timezone);
  if (!products.length) return true;
  const rows = await db.currentDcInventoryObservation.findMany({ where: { organizationId, productId: { in: products.map(product => product.id) }, businessDate: new Date(today), sourceBusinessDate: new Date(today), locationCode: { in: [...dcWarehouses] } }, select: { productId: true, locationCode: true } });
  const observed = new Set(rows.map(row => pair(row.productId, row.locationCode)));
  return products.every(product => dcWarehouses.every(location => observed.has(pair(product.id, location))));
}

export function emptyDcInventorySignal(product: Pick<ForecastProduct, 'id' | 'code' | 'name'>): CurrentDcInventorySignal {
  const empty = (): CurrentDcInventoryWarehouseSignal => ({ inventoryCases: null, quantityCases: null, pickedCases: null, businessDate: null, sourceBusinessDate: null, sourceObservedAt: null, sourceUpdatedAt: null, status: 'PENDING', stale: false, retained: false, reason: null, checkedAt: null });
  return { productId: product.id, itemCode: product.code, productName: product.name, byWarehouse: { GPT: null, GRN: null }, warehouses: { GPT: empty(), GRN: empty() }, sourceBusinessDate: null, sourceObservedAt: null, sourceUpdatedAt: null, status: 'PENDING', stale: false, retained: false, reason: null };
}

/** Compact reads only: neither raw export rows nor forecast detail are loaded. */
export async function getDcInventorySignals(organizationId: string, db: PrismaClient = prisma, now = new Date()) {
  const organization = await forecastAccess(db, organizationId), today = formatDateInputValue(now, organization.timezone);
  const products = organization.enabledStates.includes('OH') ? await configuredProducts(db, organizationId, ['OH']) : [];
  const productIds = products.map(product => product.id);
  // DISTINCT ON runs in PostgreSQL, so retained history never expands the
  // dashboard payload. Prisma's ordinary distinct is evaluated in the client.
  type Observation = Pick<CurrentDcInventoryObservation, 'productId' | 'locationCode' | 'businessDate' | 'sourceBusinessDate' | 'sourceObservedAt' | 'sourceUpdatedAt' | 'quantityCases' | 'pickedCases' | 'inventoryCases'>;
  type Check = Pick<CurrentDcInventoryCheck, 'productId' | 'locationCode' | 'businessDate' | 'checkedAt' | 'status' | 'reason'>;
  const [observations, checks] = productIds.length ? await Promise.all([
    db.$queryRaw<Observation[]>(Prisma.sql`SELECT DISTINCT ON ("productId", "locationCode") "productId", "locationCode", "businessDate", "sourceBusinessDate", "sourceObservedAt", "sourceUpdatedAt", "quantityCases", "pickedCases", "inventoryCases"
      FROM "CurrentDcInventoryObservation" WHERE "organizationId"=${organizationId} AND "productId" IN (${Prisma.join(productIds)}) AND "locationCode" IN ('GPT','GRN') ORDER BY "productId", "locationCode", "businessDate" DESC, "sourceObservedAt" DESC, "id" DESC`),
    db.$queryRaw<Check[]>(Prisma.sql`SELECT DISTINCT ON ("productId", "locationCode") "productId", "locationCode", "businessDate", "checkedAt", "status", "reason"
      FROM "CurrentDcInventoryCheck" WHERE "organizationId"=${organizationId} AND "productId" IN (${Prisma.join(productIds)}) AND "locationCode" IN ('GPT','GRN') ORDER BY "productId", "locationCode", "businessDate" DESC, "checkedAt" DESC, "id" DESC`),
  ]) : [[], []];
  const observationByPair = new Map(observations.map(row => [pair(row.productId, row.locationCode), row])), checkByPair = new Map(checks.map(row => [pair(row.productId, row.locationCode), row]));
  const rows = products.map(product => {
    const result = emptyDcInventorySignal(product);
    for (const location of dcWarehouses) {
      const observation = observationByPair.get(pair(product.id, location)), check = checkByPair.get(pair(product.id, location));
      const businessDate = observation ? day(observation.businessDate) : null, sourceBusinessDate = observation ? day(observation.sourceBusinessDate) : null;
      const effectiveCheck = check && (!businessDate || day(check.businessDate) >= businessDate) ? check : null;
      const status = (['AVAILABLE', 'UNAVAILABLE', 'FAILED', 'PENDING'] as const).find(value => value === effectiveCheck?.status) ?? (observation ? 'AVAILABLE' : 'PENDING');
      const observedValid = observation && Number.isFinite(observation.sourceObservedAt.getTime()) && observation.sourceObservedAt <= now;
      const stale = Boolean(observation && (!observedValid || businessDate !== today || sourceBusinessDate !== today || formatDateInputValue(observation.sourceObservedAt, organization.timezone) !== today));
      result.warehouses[location] = { inventoryCases: number(observation?.inventoryCases), quantityCases: number(observation?.quantityCases), pickedCases: number(observation?.pickedCases), businessDate, sourceBusinessDate, sourceObservedAt: observation?.sourceObservedAt.toISOString() ?? null, sourceUpdatedAt: observation?.sourceUpdatedAt?.toISOString() ?? null, status, stale, retained: Boolean(observation && (status !== 'AVAILABLE' || stale)), reason: effectiveCheck?.reason ?? null, checkedAt: check?.checkedAt.toISOString() ?? null };
      result.byWarehouse[location] = result.warehouses[location].inventoryCases;
    }
    const values = dcWarehouses.map(location => result.warehouses[location]);
    result.sourceBusinessDate = values[0].sourceBusinessDate === values[1].sourceBusinessDate ? values[0].sourceBusinessDate : null;
    result.sourceObservedAt = values.some(value => value.sourceObservedAt) ? values.flatMap(value => value.sourceObservedAt ? [value.sourceObservedAt] : []).sort()[0] : null;
    result.sourceUpdatedAt = null; // The verified report supplies a date, no publication clock.
    result.status = values.every(value => value.status === 'AVAILABLE') ? 'AVAILABLE' : values.some(value => value.status === 'FAILED') ? 'FAILED' : values.every(value => value.status === 'PENDING') ? 'PENDING' : 'UNAVAILABLE';
    result.stale = values.some(value => value.stale); result.retained = values.some(value => value.retained);
    result.reason = values.find(value => value.reason)?.reason ?? null;
    return result;
  });
  return { today, rows };
}
