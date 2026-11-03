# Production Forecasting source-line exclusion

Owner-authorized correction, November 3, 2026. The original TST-only delivery below is retained as history. The complete forecasting change is now released to main as **0.6.0**, and the exact approved exclusion is independently verified and active in production. Original source records, prior predictions and unrelated organization settings remain preserved.

## Diagnosis

`DIRECT:<Agency>` is generated from a Bailment invoice's Agency field when the invoice has no shipment date, transfer-order number or distribution-center name. It is an invoice grouping, not a verified warehouse identity.

Read-only verified TST evidence traced `DIRECT:50114` to one native invoice: item 2829B (Copper Label Brandy), October 5, 2021, five cases. The native record's canonical source identity is `v1:c5bfe68a8e1f5df98fe997491382c784a8e4544d14042e36deb56a9aae6773b6`. The owner identified a possible known source error and explicitly authorized excluding this line. Its business identity could not be matched to the CRM Agency directory.

The complete-history importer established zero-coverage series for all configured products at every observed grouping. This one line therefore created 29 additional zero-only product/grouping pairs, alongside its original product. The original invoice predates the bounded three-year model window, leaving all current series at that grouping zero. The original lowest-location confidence rule lets those zero-only series contribute Low because their percentage-error and volatility metrics are undefined.

Other direct groups contain real demand and remain relevant. Removing this particular grouping from the old rating calculation still leaves all 17 current products Low at all three horizons due to other active-demand error or variability. No confidence threshold change or higher-rating claim is part of this correction.

## Correction design

- Store an explicit, reasoned exclusion in the organization's Production Forecasting settings, matching canonical source identity, market, product, movement date and location together.
- Apply it when reading forecast inputs, including future refreshes/imports and historical audits. Retain raw imports, original invoice evidence, revisions and saved predictions.
- Remove an affected direct grouping from new planning only when its source support consists solely of the approved excluded line and verified generated zero-coverage records. An independent valid invoice to the same agency keeps or reestablishes the grouping; there is no permanent agency-wide ban.
- Retain the covered zero series for settling actuals of older saved forecasts that expected the grouping. Earlier predictions stay immutable.
- Record the policy in run identity/configuration and source diagnostics. No migration, provider change or source-import deletion.
- Current review exclusions apply as a corrected-data policy in reconstructed audits; they do not claim to reconstruct when a historical operator knew about the error.

## Historical TST validation and delivery

- 35 existing forecasting/eligibility/horizon/access checks and 11 new source-exclusion tests passed. The new tests cover exact matching, corrected and future invoices, delisted original products, physical warehouse/manual-zero preservation, tenant scope, policy-sensitive replay, and old-horizon settlement with immutable predictions. Maintained fixtures are synthetic.
- Completed full suite: **919 tests / 74 suites passed**, no failures or skips, 55.8 seconds. Strict `npm run typecheck`, optimized Next webpack build with the verified TST environment, and `git diff --check` passed. No schema, dependency, provider or UI files changed.
- Database-enforced read-only TST preview matched the original native line exactly once. It produced 85 planning series while retaining all 102 covered series for old-forecast actual evaluation: 17 proven derived planning scopes at `DIRECT:50114` were omitted. No policy or source data was written during the preview.
- Application commit `4617fd0babdebcfc07bab702d7a3440f9375bd0e` deployed to `neat-tst:tst`. Vercel deployment `dpl_BSTgRJczGFmfBPUuipwXe46eKEWo` is READY. Health returned `ok: true`, connected, environment `test`, target `neon-neat-tst`.
- Applied exactly one owner-approved rule in `org_echo_spirits` settings, with reason and actual approval timestamp. It matched the approved source identity once; all other settings were unchanged by digest comparison. No broader agency/product exclusion was added.
- Refreshed model v1.4 into run `cmw0u8a410001upns54y03oxq`. All 17 products have numeric saved forecasts across 30/60/90 days, with no `DIRECT:50114` in current detail. Repeating the refresh reused the same run. Refresh plus all per-product/horizon persistence checks completed in 43.6 seconds.
- All **204** older prediction documents and scalar forecasts were unchanged by digest comparison. Raw counts remained exactly 15 import records, 6,068 demand observations and 360 guidance observations; no original line was deleted or changed. There are 85 planning series and 102 covered series available for settling old actuals. The 17 omitted planning series are solely proven derivatives of the approved bad line.
- Forecast case totals stayed 148.13 / 297.99 / 434.79 for 30/60/90 days. Each horizon still rates all 17 products Low; this correction does not change the thresholds or the other active-demand errors/variability.
- `origin/main` independently remained `5f31360c02e6409ec889863340825401c588deea` (0.5.2). No production push, policy change, migration or provider action was performed. Operational evidence is ignored local output: `output/invoice-exclusion-input-preview.json` and `output/invoice-exclusion-applied.json`.

## Production release activation

- Exact application candidate `c5dcf07b8cc775488a3be9b69766e748bad3fb6f` is deployed READY and tagged `v0.6.0`. Public health identifies connected `production / ohlq-field-crm`; production identity and the exact native source line were verified before activation.
- Added only the approved rule: one entry, one native match, 17 proven derived planning scopes omitted. Independent source inputs and all unrelated organization settings were unchanged. No agency-wide exclusion or wholesale TST-settings copy was made.
- Refreshed model v1.4 into production run `cmw0vk5x60001upv0yb0pc5q7` in 14.14 seconds: 17 products, 85 planning / 102 covered actual series, all 17 prior expected scopes retained for actual settlement. Current grouping absence, cumulative totals, cross-tenant rejection before private queries and same-run replay all passed.
- Full digest comparisons preserved all **343** older prediction documents/scalar forecasts and complete source contents: 26 imports, 6,070 demand observations and 420 guidance observations. The original invoice is retained. All production product confidence ratings remain Low.
- Live read-only production desktop/mobile smoke verified persisted horizons, search/detail/back context, five-location detail and no horizontal overflow. See [0.6.0 validation](0.6.0-validation.md) for CI, deployment, production totals and tag receipts. Operational evidence is ignored `output/release-060-production-activation.json` in the production release worktree.
