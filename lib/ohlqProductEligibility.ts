type ProductStatus = {
  itemCode: string;
  solItemStatusCode: string | null;
};

type InventoryDiagnostics = {
  distilleryOnlyItemCodes?: unknown;
};

export const OHLQ_WHOLESALE_ACTIVE_STATUS_CODE = '70';

export function getDistilleryOnlyItemCodes(diagnostics: unknown) {
  if (!diagnostics || typeof diagnostics !== 'object') return new Set<string>();
  const itemCodes = (diagnostics as InventoryDiagnostics).distilleryOnlyItemCodes;
  if (!Array.isArray(itemCodes)) return new Set<string>();
  return new Set(itemCodes.map(String).map((itemCode) => itemCode.trim()).filter(Boolean));
}

export function isOpportunityEligibleOhlqProduct(
  product: ProductStatus,
  distilleryOnlyItemCodes: ReadonlySet<string>,
) {
  return product.solItemStatusCode?.trim() === OHLQ_WHOLESALE_ACTIVE_STATUS_CODE
    && !distilleryOnlyItemCodes.has(product.itemCode);
}
