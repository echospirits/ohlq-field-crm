export const MAX_DIRECT_WHOLESALE_ORDER_LINES = 7;

export type DirectWholesaleOrderLineInput = {
  itemCode: string;
  quantityBottles: number;
  wholesalePrice: number;
};

export type DirectWholesaleOrderPdfPayload = {
  a3aSignature: string;
  customer: {
    address: string;
    city: string;
    dba: string;
    f2Permit: boolean;
    name: string;
    permitNumber: string;
    phone: string;
    postalCode: string;
    state: string;
  };
  customerSignature: string;
  directSaleLocationId: string;
  lines: DirectWholesaleOrderLineInput[];
  saleDate: string;
  sinTax: number;
  wholesaleAccountId: string;
};

export const toCurrencyCents = (value: number) => Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100);
export const fromCurrencyCents = (value: number) => value / 100;

export function calculateDirectWholesaleOrderTotals(lines: DirectWholesaleOrderLineInput[], sinTax: number) {
  const lineSubtotals = lines.map((line) => line.quantityBottles * toCurrencyCents(line.wholesalePrice));
  const subtotalCents = lineSubtotals.reduce((sum, value) => sum + value, 0);
  const sinTaxCents = toCurrencyCents(sinTax);
  return {
    lineSubtotals: lineSubtotals.map(fromCurrencyCents),
    sinTax: fromCurrencyCents(sinTaxCents),
    subtotal: fromCurrencyCents(subtotalCents),
    total: fromCurrencyCents(subtotalCents + sinTaxCents),
  };
}
