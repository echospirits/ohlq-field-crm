import Papa from 'papaparse';
import { validDay } from '../model';

export const DC_INVENTORY_SOURCE = 'OHLQ_POWER_BI_DC_INVENTORY';
export const DC_INVENTORY_REPORT_ID = '6b07a165-c515-4f63-bef4-471ef64e3e96';
export const DC_INVENTORY_ADAPTER_VERSION = 'dc-inventory-quantity-plus-picked-v1';
export const dcWarehouses = ['GPT', 'GRN'] as const;
export type DcWarehouse = typeof dcWarehouses[number];
export type DcInventoryDownload =
  | { status: 'ok'; csv: string; observedAt: string; reportDate: string }
  | { status: 'failed'; observedAt: string; reason: 'upstream-authentication' | 'upstream-unavailable' | 'invalid-response' };
export type ParsedDcWarehouse = { inventoryCases: number | null; quantityCases: number | null; pickedCases: number | null; reason: string | null };
export type ParsedDcInventoryProduct = {
  itemCode: string; vendorId: string; sourceBusinessDate: string | null;
  warehouses: Record<DcWarehouse, ParsedDcWarehouse>;
  evidence: Record<string, unknown>;
};
const headers = ['Vendor_Name', 'Vendor_Number', 'Broker_Number', 'Broker_Name', 'As_of_Date', 'Brand_Code', 'Name', 'Status', 'Case_Count', 'GPT_Quantity', 'GPT_Picked', 'GPTR_Quantity', 'GRN_Quantity', 'GRN_Picked', 'GRNR_Quantity', 'Total'];
const key = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[ _]+/g, '');
const token = (value: string | undefined) => (value ?? '').trim().toUpperCase();
function sourceDay(value: string | undefined) {
  const raw = (value ?? '').trim();
  if (validDay(raw)) return raw;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const day = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : '';
  return validDay(day) ? day : null;
}
function quantity(value: string | undefined) {
  const raw = (value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(\.\d{1,4})?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number <= 1e8 ? number : null;
}
const unavailable = (reason: string): ParsedDcWarehouse => ({ inventoryCases: null, quantityCases: null, pickedCases: null, reason });

/** Verified native report quantities are cases. Picked stock is included by
 * owner instruction; GPTR/GRNR are retained as evidence and never counted. */
export function parseDcInventoryCsv(csv: string, { businessDate, vendorIds, itemCodes }: { businessDate: string; vendorIds: readonly string[]; itemCodes: readonly string[] }) {
  if (!validDay(businessDate) || Buffer.byteLength(csv, 'utf8') > 8 * 1024 * 1024) throw new Error('Invalid DC inventory source window or size.');
  const first = Papa.parse(csv, { preview: 1, skipEmptyLines: 'greedy' }) as { data: string[][] };
  const originalHeaders = first.data[0]?.map(key) ?? [];
  if (new Set(originalHeaders).size !== originalHeaders.length || headers.some(header => !originalHeaders.includes(key(header)))) throw new Error('Verified native DC inventory headers are required.');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: key }) as { data: Record<string, string>[]; errors: unknown[] };
  if (parsed.errors.length || !parsed.data.length || parsed.data.length > 50000) throw new Error('DC inventory CSV is malformed or incomplete.');
  const vendors = new Set(vendorIds), allowed = new Set(itemCodes);
  const products = new Map<string, ParsedDcInventoryProduct>(), identities = new Map<string, string>();
  let outsideScopeRows = 0, duplicateRows = 0;
  for (const row of parsed.data) {
    const itemCode = token(row.brandcode), vendorId = token(row.vendornumber);
    if (!itemCode || !vendorId || !/^[A-Z0-9_-]{1,80}$/.test(itemCode) || !/^[A-Z0-9_-]{1,80}$/.test(vendorId)) throw new Error('DC inventory source identity is incomplete.');
    if (!allowed.has(itemCode) || !vendors.has(vendorId)) { outsideScopeRows++; continue; }
    const identity = JSON.stringify(headers.map(header => row[key(header)]?.trim() ?? ''));
    const old = identities.get(itemCode);
    if (old !== undefined) {
      if (old === identity) duplicateRows++;
      else {
        const product = products.get(itemCode)!;
        product.warehouses = { GPT: unavailable('CONFLICTING_PRODUCT_ROWS'), GRN: unavailable('CONFLICTING_PRODUCT_ROWS') };
      }
      continue;
    }
    identities.set(itemCode, identity);
    const sourceBusinessDate = sourceDay(row.asofdate);
    const sourceIssue = !sourceBusinessDate || sourceBusinessDate > businessDate ? 'INVALID_SOURCE_DATE' : sourceBusinessDate < businessDate ? 'STALE_SOURCE' : token(row.status) === '30' ? 'SOURCE_INELIGIBLE' : !row.status?.trim() ? 'INVALID_RESPONSE' : null;
    const warehouses = Object.fromEntries(dcWarehouses.map(location => {
      const quantityCases = quantity(row[`${location.toLowerCase()}quantity`]), pickedCases = quantity(row[`${location.toLowerCase()}picked`]);
      const inventoryCases = quantityCases === null || pickedCases === null ? null : Math.round((quantityCases + pickedCases) * 10000) / 10000;
      const reason = sourceIssue ?? (inventoryCases === null || inventoryCases > 1e8 ? 'INVALID_QUANTITY' : null);
      return [location, reason ? unavailable(reason) : { inventoryCases, quantityCases, pickedCases, reason: null }];
    })) as Record<DcWarehouse, ParsedDcWarehouse>;
    products.set(itemCode, { itemCode, vendorId, sourceBusinessDate, warehouses, evidence: {
      source: DC_INVENTORY_SOURCE, reportId: DC_INVENTORY_REPORT_ID, adapterVersion: DC_INVENTORY_ADAPTER_VERSION,
      vendorId, itemCode, sourceBusinessDate, casePack: row.casecount?.trim() ?? null,
      native: Object.fromEntries(headers.map(header => [header, row[key(header)] ?? ''])),
      included: ['GPT_Quantity', 'GPT_Picked', 'GRN_Quantity', 'GRN_Picked'], excluded: ['GPTR_Quantity', 'GRNR_Quantity'],
    } });
  }
  return { products: [...products.values()], rawRows: parsed.data.length, outsideScopeRows, duplicateRows };
}
