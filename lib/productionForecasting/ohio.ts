import Papa from 'papaparse';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getDistilleryOnlyItemCodes } from '../ohlqProductEligibility';
import { type Classification, validDay } from './model';
export type ForecastBailmentProduct = { itemCode: string; itemName: string; vendorId: string };
export type OhioItemContext = { included: Set<string>; distilleryOnly: Set<string>; bailment: Set<string>; forecastProducts?: ForecastBailmentProduct[] };
export type NativeOhioOptions = { start: string; end: string; directInvoices?: 'invoice-date' | 'shipment-only'; fullPortfolio?: boolean };
export async function ohioItemContext(db: PrismaClient | Prisma.TransactionClient, organizationId: string): Promise<OhioItemContext> {
  const [products, listings, status, vendors] = await Promise.all([
    db.organizationProduct.findMany({ where: { organizationId, market: 'OH', active: true, discontinued: false, status: { in: ['OWNED', 'REPRESENTED'] } }, select: { externalItemCode: true } }),
    db.ohlqAgencyInventoryCurrent.findMany({ where: { organizationId }, distinct: ['itemCode', 'detailCodeDescription', 'vendorId'], select: { itemCode: true, itemName: true, vendorId: true, detailCodeDescription: true } }),
    db.ohlqTenantInventoryImportStatus.findFirst({ where: { organizationId, status: 'COMPLETED' }, orderBy: { reportDate: 'desc' }, select: { diagnostics: true } }),
    db.organizationVendorIdentifier.findMany({ where: { organizationId, market: 'OH', active: true }, select: { vendorId: true } }),
  ]);
  const distilleryOnly = getDistilleryOnlyItemCodes(status?.diagnostics), bailment = new Set<string>();
  for (const listing of listings) {
    const detail = (listing.detailCodeDescription ?? '').trim().toUpperCase().replace('A-3A', 'A3A').replace(/\s+/g, ' ');
    if (['A3A DIST', 'A3A DISTILLERY ONLY'].includes(detail)) distilleryOnly.add(listing.itemCode);
    if (['A3A BAIL', 'A3A BAILMENT'].includes(detail)) bailment.add(listing.itemCode);
  }
  // The inventory importer already distinguishes a bailment listing from a
  // separate distillery-only listing when producing its diagnostic item set.
  for (const code of bailment) if (!getDistilleryOnlyItemCodes(status?.diagnostics).has(code)) distilleryOnly.delete(code);
  const vendorIds = new Set(vendors.map(v => v.vendorId));
  const diagnostics = status?.diagnostics as { forecastBailmentProducts?: unknown } | null;
  // New complete reports retain vendor/classification evidence BEFORE the sales
  // portfolio filter. An explicit empty list must not revive stale inventory.
  const candidates: unknown[] = Array.isArray(diagnostics?.forecastBailmentProducts)
    ? diagnostics.forecastBailmentProducts
    : listings.filter(row => ['A3A BAIL', 'A3A BAILMENT'].includes((row.detailCodeDescription ?? '').trim().toUpperCase().replace('A-3A', 'A3A').replace(/\s+/g, ' ')));
  const forecastProducts = new Map<string, ForecastBailmentProduct>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Partial<ForecastBailmentProduct>;
    if (typeof row.itemCode !== 'string' || !row.itemCode.trim() || typeof row.itemName !== 'string' || !row.itemName.trim() || typeof row.vendorId !== 'string' || !vendorIds.has(row.vendorId)) continue;
    forecastProducts.set(row.itemCode, { itemCode: row.itemCode, itemName: row.itemName, vendorId: row.vendorId });
    bailment.add(row.itemCode);
    distilleryOnly.delete(row.itemCode); // Positive bailment evidence wins over a separate distillery listing.
  }
  return { included: new Set([...products.map(p => p.externalItemCode), ...forecastProducts.keys()]), distilleryOnly, bailment, forecastProducts: [...forecastProducts.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode)) };
}
export function classificationForItem(code: string, context: OhioItemContext): Classification {
  return context.distilleryOnly.has(code) ? 'A3A_DIST' : context.bailment.has(code) ? 'A3A_BAIL' : 'BAILMENT';
}
/** Current planning/display eligibility; source imports retain historical facts. */
export async function ohioForecastExcludedItemCodes(db: PrismaClient | Prisma.TransactionClient, organizationId: string, itemCodes: string[]) {
  const [context, catalog] = await Promise.all([
    ohioItemContext(db, organizationId),
    db.ohlqBrandMasterItem.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, solItemStatusCode: true } }),
  ]);
  // Brand Master status 30 is delisted; missing status is not a delisting.
  return new Set([...context.distilleryOnly, ...catalog.filter(p => p.solItemStatusCode?.trim() === '30').map(p => p.itemCode)]);
}
function sourceDate(value: string, field: string) {
  const trimmed = value.trim();
  if (validDay(trimmed)) return trimmed;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const iso = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : '';
  if (!validDay(iso)) throw new Error(`Native source has an invalid ${field}. Use MM/DD/YYYY or YYYY-MM-DD.`);
  return iso;
}
const numeric = (value: string, field: string) => {
  const cleaned = value.trim().replaceAll(',', '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Native source ${field} must be a nonnegative number.`);
  return Number(cleaned);
};
const headerKey = (value: string) => value.replace(/^\uFEFF/, '').replaceAll('\u00a0', ' ').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
export function normalizeNativeOhio(csv: string, source: string, context: OhioItemContext, options?: NativeOhioOptions) {
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: headerKey }) as { data: Record<string, string>[]; errors: unknown[]; meta: { fields?: string[] } };
  if (parsed.errors.length) throw new Error('Native source CSV/TSV is malformed. Export the report as a delimited file.');
  const fields = parsed.meta.fields ?? [];
  const demand = source === 'BAILMENT_PO_INVOICE' && fields.includes('Invoice_Number');
  const guidance = source === 'DISTRIBUTION_CENTER' && fields.includes('Code');
  if (!demand && !guidance) return null;
  const required = demand ? ['Invoice_Date', 'Invoice_Number', 'PO_Number', 'Transfer_Order_Number', 'Agency', 'Transfer_Order_Ship_Date', 'Brand', 'DC_Name', 'Cases', 'Odd_Bottles', 'Cases_Bottles'] : ['Code', 'Groveport - MAX (45 Days)', 'Groveport - MIN (14 Days)', 'Green - MAX (45 Days)', 'Green - MIN (14 Days)'];
  const missing = required.filter(h => !fields.includes(h));
  if (missing.length) throw new Error(`Native source headers missing: ${missing.join(', ')}.`);
  const normalized: Record<string, string | number>[] = [];
  const evidence = new Map<string, Record<string, string>>();
  let outOfScopeRows = 0, outsideWindowRows = 0, directRows = 0, unshippedRows = 0;
  for (const [index, row] of parsed.data.entries()) {
    const code = (row[demand ? 'Brand' : 'Code'] ?? '').trim().toUpperCase();
    if (!code) throw new Error(`Native source row ${index + 2} has no item code; completeness cannot be verified.`);
    // Forecast-only vendor bailment items do not alter the sales portfolio.
    if (!context.included.has(code)) { outOfScopeRows++; continue; }
    const classification = classificationForItem(code, context);
    if (demand) {
      if (!row.Invoice_Number?.trim()) throw new Error(`Native source row ${index + 2} has no invoice number.`);
      const shipped = Boolean(row.Transfer_Order_Ship_Date?.trim());
      if (!shipped && !options?.directInvoices) throw new Error(`Native source row ${index + 2} is not a shipped invoice. Configure how direct invoices are treated before importing full history.`);
      if (!shipped && options?.directInvoices === 'shipment-only') { unshippedRows++; continue; }
      if (!shipped && (row.Transfer_Order_Number?.trim() || row.DC_Name?.trim())) throw new Error(`Native source row ${index + 2} has incomplete shipment evidence.`);
      const invoiceDate = sourceDate(row.Invoice_Date, 'invoice date');
      const date = shipped ? sourceDate(row.Transfer_Order_Ship_Date, 'ship date') : invoiceDate;
      if (options && (date < options.start || date > options.end)) { outsideWindowRows++; continue; }
      if (!row.Cases?.trim() && !row.Odd_Bottles?.trim()) throw new Error(`Native source row ${index + 2} has no case or bottle quantity.`);
      const cases = numeric(row.Cases?.trim() || '0', 'Cases'), odd = numeric(row.Odd_Bottles?.trim() || '0', 'Odd_Bottles');
      const pack = /^C(\d+)$/i.exec((row.Cases_Bottles ?? '').trim());
      if (odd && (!pack || Number(pack[1]) <= 0)) throw new Error(`Native source row ${index + 2}: odd bottles require a valid C6/C12/etc. case pack.`);
      const location = shipped ? row.DC_Name.trim() : row.Agency?.trim() ? `DIRECT:${row.Agency.trim()}` : 'DIRECT:UNSPECIFIED';
      if (!location) throw new Error(`Native source row ${index + 2} has no fulfillment location.`);
      const id = JSON.stringify([row.Invoice_Number.trim(), row.Transfer_Order_Number.trim(), row.Agency.trim(), code, location]);
      if (id.length > 200) throw new Error('Native source invoice identity exceeds the supported length.');
      if (!shipped) directRows++;
      normalized.push({ source_line_id: id, movement_date: date, available_on: invoiceDate > date ? invoiceDate : date, item_code: code, location_code: location.toUpperCase(), location_name: !shipped ? row.Agency?.trim() ? `Direct fulfillment ${row.Agency.trim()}` : 'Unspecified fulfillment' : location, classification, transaction_status: shipped ? 'SHIPPED' : 'POSTED', cases: Math.round((cases + (odd ? odd / Number(pack![1]) : 0)) * 10000) / 10000 });
      evidence.set(id, row);
    } else {
      for (const [name, codeName] of [['Groveport', 'GPT'], ['Green', 'GRN']]) {
        normalized.push({ item_code: code, location_code: codeName, location_name: name, classification, minimum_cases: row[`${name} - MIN (14 Days)`] ?? '', maximum_cases: row[`${name} - MAX (45 Days)`] ?? '' });
        evidence.set(JSON.stringify([code, codeName]), row);
      }
    }
  }
  if (!normalized.length) throw new Error('Native source contains no eligible Production Forecasting items in the requested period.');
  // Only a verified, unfiltered full-portfolio export may establish zeroes for
  // configured products absent from the report. Manual slices keep their scope.
  if (demand && options?.fullPortfolio) {
    const locations = new Map<string, string>([['GPT', 'Groveport'], ['GRN', 'Green']]);
    for (const row of normalized) locations.set(String(row.location_code), String(row.location_name));
    const present = new Set(normalized.map(r => JSON.stringify([r.item_code, r.location_code])));
    for (const code of context.included) for (const [location, name] of locations) if (!present.has(JSON.stringify([code, location]))) {
      normalized.push({ source_line_id: `coverage:${code}:${location}`, movement_date: options.start, available_on: options.start, item_code: code, location_code: location, location_name: name, classification: classificationForItem(code, context), transaction_status: 'POSTED', cases: 0 });
    }
  }
  return { csv: Papa.unparse(normalized), evidence, outOfScopeRows, outsideWindowRows, directRows, unshippedRows, adapterVersion: demand ? 'ohio-bailment-invoice-v2' : 'ohio-distribution-center-v1' };
}
