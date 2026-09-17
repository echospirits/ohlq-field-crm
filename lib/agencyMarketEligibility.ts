import { getDistilleryOnlyItemCodes, isOpportunityEligibleOhlqProduct } from './ohlqProductEligibility';

type StoreListing = { itemCode: string; detailCodeDescription: string | null; status: string | null };

/** Positive statewide store-distribution evidence, not stock at the candidate agency. */
export function getAgencyMarketEligibleItemCodes({ catalog, listings, diagnostics }: {
  catalog: Array<{ itemCode: string; solItemStatusCode: string | null }>;
  listings: StoreListing[];
  diagnostics: unknown;
}) {
  const restricted = getDistilleryOnlyItemCodes(diagnostics);
  const listed = new Set(listings.filter((row) =>
    !/^A3A\s+DIST(?:ILLERY)?(?:\s+ONLY)?$/i.test(row.detailCodeDescription?.trim() ?? '')
    && !/delist/i.test(row.status ?? ''),
  ).map((row) => row.itemCode));
  return new Set(catalog.filter((item) =>
    listed.has(item.itemCode) && isOpportunityEligibleOhlqProduct(item, restricted),
  ).map((item) => item.itemCode));
}
