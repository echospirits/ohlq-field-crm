# Analytics V1 checkpoint

## Completed checkpoints 1–8; ready for staging publication

- Target: tst → staging/tst (echospirits/neat-tst). Starting HEAD 76817f9e. Never publish to origin/main.
- User selected option 2: preserve retention; disclose unavailable historical metrics. No schema, migration, importer, retention or deployment-configuration changes.
- Authenticated Organization context → owned/represented products (including inactive historical products) → market adapter → shared summaries/drill-downs/CSV. No vendor fallback or customer-specific product constants.
- Ohio adapter reuses daily Agency retail and wholesale-by-permit rows. SQL verifies physically retained counts against completed, unskipped imports. Queries share a repeatable-read snapshot. No per-account queries or browser-side sales-history calculation.
- Ambiguous permit identities remain unresolved: bottles included; account/distribution counts excluded. Public identity fields only; all CRM reads Organization-scoped.
- First observed means first in retained history, not lifetime acquisition. Lapse reuses 90-day lookback / no purchase in 30 days. Comparisons require full equal-length coverage. Visit association is strictly later calendar date, within 30 days; incomplete follow-up remains unknown. No causal claims or invented revenue.
- Three views, URL filters, searchable products, account search/sort/pagination, distribution drill-downs, account/product CSV, availability/source explanations, loading/error/empty states. Desktop navigation and mobile More link added.

## Material files

- lib/analytics/{model,ohio,service,csv}.ts
- app/analytics/ routes, filters, server-rendered view, styles and boundaries
- app/components/navigationConfig.ts and AppNavigation.tsx
- tests/analytics.test.ts, tests/fixtures/analytics.ts, navigation expectations

## Validation so far

- 51 focused + existing Ohio import/retention/sales/matching/digest/navigation tests passed, including the no-products CRM activity case.
- Final typecheck and production build passed. Removed stale development route metadata from the temporary preview before the successful build.
- Real staging adapter queries checked three organizations in read-only transactions. No-product tenant returned unavailable. Two populated tenants returned distinct scoped portfolios; selected week had 3/7 fully covered days. Queries approximately 2–4 seconds.
- Synthetic browser review: 390x844 and 1440x1000; no horizontal overflow. Verified KPI drill-down count, live search, prior-year unavailability, disabled groups, empty state, error boundary. Screenshots: ignored output/playwright/analytics-*.
- Anonymous real page redirected to login without sales results; CSV returned 307 to login.
- Temporary synthetic preview removed before build. No authentication sessions created: automatic approval review rejected Platform Admin session creation. Existing signed-in staging browser tab is available for postdeployment verification instead.

## Remaining

1. Final tenant/query review complete: private reads scoped; shared facts restricted by Organization products; batched queries; no raw history serialized to the browser.
2. Commit scoped files; push only staging/tst.
3. Verify matching Vercel deployment READY, staging health and authenticated Analytics through existing browser session.
4. Temporary connection file removed. Report final commit/results after release verification.
