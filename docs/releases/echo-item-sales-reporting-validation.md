# Echo Item Sales reporting adapter: validation

**Historical TST acceptance, November 20, 2026.** The owner's November 21 clarification directs all Echo backfill and future production reporting to `ohlq-field-crm/main`; this record remains evidence for the tested adapter and does not authorize loading or synchronizing TST. Both reusable sources in the same copied preview have subsequently been reconnected to production main. Current production migration/connection evidence and application-promotion status are tracked in [0.15.0 validation](0.15.0-validation.md) and the [main-only handoff](../engineering/echo-item-sales-main-backfill-handoff.md); the dated TST statements below remain historical.

**Status: the adapter is published to TST and its exact deployment is READY/healthy; database, local build, both Looker sources, saved preview bindings/status and final View-mode reload/visual QA pass. Populated-history reconciliation and production reporting release remain pending.** The TST package version remains **0.10.0-dev**. This reporting change leaves production application/database and the existing production dashboard unchanged; the separate production backfill is independently owned.

## Scope and exact artifacts

The adapter adds `EchoBottleSalesDayCoverage`, private day validation, and two fixed-Echo reporting views. The main view preserves the ten Item Sales source fields and publishes only contiguous certified closed-month history sufficient for the existing matched current/prior-year comparisons. Source ingestion and backfill are separately owned; this change does not alter importers, workflows, schedules, product/tenant rules, retention, package metadata or dependencies.

| Artifact | Exact receipt |
| --- | --- |
| Starting TST application | `7b80a0768ca209da913fb7f6908e20aaa8749423` |
| Published [TST application](https://github.com/echospirits/neat-tst/commit/29bc495975ecf80b4fb4524b6baa8f8f50222f6b) | `29bc495975ecf80b4fb4524b6baa8f8f50222f6b` on `neat-tst/tst` |
| Published application tree | `ddb4b0290eb6f72176cfc03a4c3296a5614faa9b` |
| [Migration](../../prisma/migrations/20261120020000_echo_item_sales_reporting/migration.sql) | `20261120020000_echo_item_sales_reporting` |
| Migration SHA-256 | `1af46d4ad24f9ed078ccd77c937ed2c3ccd1dcb57fe001906cd1027d2dfa31b9` |
| [Behavioral SQL fixtures](../../tests/echo-item-sales-reporting-fixtures.sql) SHA-256 | `56096964d2d7d15223b9e182330d293f9f79f9796b459e6a91da3933b09ddfdc` |
| Schema | Additive `EchoBottleSalesDayCoverage` model in `prisma/schema.prisma` |
| Integration specification | [Echo bottle-sales reporting contract](../engineering/echo-item-sales-reporting.md) |
| Live Looker calculation capture | [Six preserved calculations, status formula and preview wiring](../engineering/echo-item-sales-looker-fields.json) |

The migration accepts source-evidence dates from year 0001 while keeping private validation and dashboard/calendar coverage fixed to January 2025 onward. It uses native PostgreSQL SHA-256 with specified JSONB encoding and adds no extension or index. Current master labels take precedence over the two verified A3A fallbacks; missing dimensions never remove sales quantities.

## Exact-final PostgreSQL rehearsal

On **November 20, 2026**, the exact migration above was applied to the disposable production-derived branch **`br-quiet-art-amaek8yc`**, running PostgreSQL **17.12**. This fresh branch establishes the final SQL artifact, rather than relying on the earlier provisional migration or subsequent manual alterations.

The exact fixture file passes **15 domain scenario groups**, including **15 invalid-receipt mutations** rejected by database constraints. Coverage includes the original field contract, signed quantities and wholesale-detail non-addition, explicit zero days, missing/noncontiguous dates, same-count/same-total fact changes, matched-year gating, current-month exclusion, missing/current/A3A dimensions, fixed-vendor and organization scope, pre-dashboard receipt exclusion, and future-completion rejection. Expected fingerprint vectors are independently calculated rather than read from the implementation view.

All fixture mutations run within the isolated transaction and are rolled back. Independent post-rollback checks confirm **635 existing Echo summary rows unchanged**, **zero coverage receipts**, and **zero retained fixture rows**. No source report was downloaded and no existing data was certified by the rehearsal.

The empty main report is the correct initial result. The status view returns **`AWAITING_CERTIFIED_HISTORY`**, with no invented reporting-through month or successful historical completeness. This is an intentional dependency on validated ingestion, not an empty-source success claim.

## Restricted-login and local checks

An actual isolated reporting login authenticates and successfully selects both `echo_item_sales_reporting` and `echo_item_sales_reporting_status`; a raw `OhlqAnnualSalesRow` read is denied. This verifies the intended read path using the restricted connection itself. Credentials and sensitive connection details are excluded from this record. Production privileges and credentials were not changed.

Prisma **6.19.3** schema validation and source diff whitespace checks pass. The database evidence concerns the additive schema, SQL behavior and restricted reporting connection; it does not establish live provider provenance, ingestion atomicity or historical dashboard reconciliation. Fresh local application gates are recorded below.

## Shared-TST migration and actual-role verification

On **November 20, 2026**, the independently verified shared-TST target was project **`dawn-frog-33352119`**, branch **`br-divine-forest-avwq2b3g`**, database **`neondb`**, running PostgreSQL **18.7**. The exact final migration's five DDL statements, its matching Prisma migration-ledger checksum and narrowly scoped grants to the existing **`looker_echo_bailment_tst`** reporting login committed in one successful transaction. No source facts were imported or certified.

Before/after readbacks match: **632 Echo summary rows**, signed totals of **866 retail bottles** and **599 wholesale bottles**, and **zero coverage receipts**. The separately recorded 635-row rehearsal baseline belongs to the production-derived disposable branch; it is not the shared-TST baseline.

The actual TST reporting login authenticates and selects both final views. The main report returns **zero rows**; status is **`AWAITING_CERTIFIED_HISTORY`** with **`Comparison_Ready=false`**, as required before validated history is loaded. Effective privilege checks return false for raw sales-table reads, evidence-table reads, private day-coverage reads and updates to the reporting view. An actual raw-table `SELECT` is rejected with SQLSTATE **`42501`**. This confirms real restricted connection behavior independently of owner-session privilege inference.

This database evidence does not establish live backfill or source-certification integration. The separate hosted application and Looker connection receipts are recorded below. The production application/database, its reporting role and original dashboard remain unchanged.

## Fresh local application gates

The independent local checks ran on **Node 24.22.3**, explicitly **not Node 22**. They do not represent a fresh Node 22 CI run.

| Check | Tool version | Result | Elapsed time |
| --- | --- | --- | --- |
| Prisma schema validation | 6.19.3 | Pass | 1.40 seconds |
| Prisma client generation | 6.19.3 | Pass | 3.68 seconds |
| Fresh TypeScript no-emit check | 5.9.3 | Pass | 41.39 seconds |
| Optimized Webpack build | Next.js 16.3.8 | Pass; 17 static pages | 72.30 seconds |

The validation left source inputs and the shared Prisma client unchanged. These checks establish local schema/type/build compatibility for this candidate; they do not replace the separate SQL fixtures, restricted-login verification or live source-data acceptance.

## Published TST application and hosted acceptance

Application **`29bc495975ecf80b4fb4524b6baa8f8f50222f6b`**, tree **`ddb4b0290eb6f72176cfc03a4c3296a5614faa9b`**, is published to **`neat-tst/tst`** with package version **0.10.0-dev**. Vercel deployment **`dpl_9KYYek2tKduJ588VoGjJNYtAveqX`** reached **READY at 2026-11-20T21:21:07.247Z** and identifies that exact application commit.

The actual Vercel project uses **Node 24.x**, not Node 22. Its **Next.js 16.3.8 Turbopack build passed in 59 seconds**. This hosted receipt is separate from the local optimized Webpack check and does not claim a Node 22 build.

Both the [exact deployment health endpoint](https://neat-mszcv3jj2-joe-1533s-projects.vercel.app/api/health) and the [canonical TST health endpoint](https://neat-tst.vercel.app/api/health) return HTTP **200** with:

```json
{"ok":true,"database":"connected","databaseTarget":"neon-neat-tst","environment":"test"}
```

This verifies the published TST application and its correct database/environment. No production promotion or release tag is claimed. Historical ingestion remains a separate gate; the completed browser acceptance is recorded below.

## Reusable Looker source connection

The [reusable Neon TST bottle-sales source](https://datastudio.google.com/u/1/datasources/c39e0d9b-fab7-45c1-bf80-81e468b562c5) authenticates successfully with the existing restricted TST credentials over SSL. The connection required **no certificate upload**. The view's fields were imported with their correct types.

The saved source has **23 fields**: the **16 reporting-view fields**, **six existing dashboard calculations**, and **Record Count**. The saved `Product`, `YTD bottles`, `Prior YTD bottles`, `Bottle change`, `Retail change`, and `Wholesale change` calculations preserve their live field IDs and formulas; their exact captured definitions are in the [Looker field contract](../engineering/echo-item-sales-looker-fields.json). This is source-definition acceptance; the empty facts remain governed by `AWAITING_CERTIFIED_HISTORY`.

The saved source inventory in the separate [preview report](https://datastudio.google.com/u/1/reporting/450b366c-ea69-4d8e-a6d9-f113d11ea513) is:

| Source | Report source ID | Attached charts | Result |
| --- | --- | --- | --- |
| Neon TST - Bottle Sales, reusable | `ds58` | 4 | Monthly, Product, Agency and Channel sales charts |
| Neon TST - Bottle Sales Status, reusable | `ds59` | 4 | One status scorecard on each bottle-sales page |
| Original Item Sales | `ds28` | 0 | Preserved source, no attached charts |
| Existing production Bailment | `ds54` | 15 | Unchanged bindings |

Other source bindings remain unchanged. The main source has **23 fields** and the status source has **13 fields**, each count including Record Count. The added status calculation **Bottle data status** (`calc_7mhdqznh9d`) translates coverage into **History pending**, **Prior year pending**, a formatted reporting-through month with optional **(partial)**, or **Check history status**. Its exact CASE formula is preserved separately in the [field manifest](../engineering/echo-item-sales-looker-fields.json), with the original six calculation definitions unchanged.

Live **History pending** is verified on all four pages: Monthly Bottle Sales, Product Performance, Agency Performance and Channel Trends. All three tables render valid empty states, and Channel Trends renders a valid empty Vega iframe. Monthly/Channel chart-specific formulas now reference the Neon raw fields: `SUM(Retail_Bottles_Sold)`, `SUM(Wholesale_Bottles_Sold)`, and `Retail_Bottles_Sold+Wholesale_Bottles_Sold` with **Sum** aggregation. The monthly total label is **Total bottles**.

Saved filter readback confirms **Neon bottle exclusions** is valid and attached to the four sales charts, with exactly two clauses: **Exclude Brand Equal 3150B AND Exclude Brand Equal 3750B**. No empty clause remains. Historical sales reconciliation is not inferred from empty charts.

**Final browser QA passes after an intentional full-report reload in View mode.** All four pages retain **History pending**. Monthly, Product and Agency tables show valid **No data** output without System Error or missing-field errors. Channel Trends renders its valid empty Vega plot with the **Retail / Wholesale / Total bottles** legend. All four page screenshots were inspected: status is legible and no elements overlap. Agency chart display labels are **Agency** and **Agency ID**; underlying identifier types remain Text, with totals and filters unchanged.

The Product preview was left open in View mode and marked as the deliverable. A final screenshot is retained at the private workspace path `/workspace/scratch/172dd72fea7b/echo-item-sales-validation/neon-bottle-preview.jpg` (**47,674 bytes**). This acceptance establishes the saved TST connection, formulas, filters, status and empty-state presentation; populated-data reconciliation remains pending.

The preview reads the TST database. The separately running production backfill does not populate it, and production has no new coverage table until this reporting migration is released there. This task has **not implemented a coverage-receipt writer**. The separate Codex task must integrate that contract for validated historical days, explicit zero days, corrections and future daily loads before the views can advance reporting coverage.

## Pending delivery and acceptance

- Integrate the documented source-receipt contract through the separately owned Codex ingestion/backfill work. Receipts and matching Echo day facts must commit atomically from a validated complete source; physical rows or old global source statuses cannot auto-certify history.
- Reconcile certified monthly/product/agency/channel totals, signed corrections, A3A rows, exclusions and matched current/prior-year periods before any production chart cutover.
- Record any subsequent production promotion separately against the actual tested candidate and existing release process.

Existing production Bailment charts, the monthly spreadsheet sources and production schedules remain untouched. A successful database connection alone is not historical-data or dashboard acceptance.
