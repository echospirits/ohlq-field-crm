# Wholesale assessment replacement (0.14-dev)

## Audit, 2026-09-29

Baseline: `staging/tst` / `0b2b316e`, package `0.14.0-dev`. The verified TST remote is `https://github.com/echospirits/neat-tst.git`; origin is production. Existing password-reset work is retained.

Code inspection found:

- `opportunityEngine.ts` infers sales availability from Ohio state, loads statewide history even for targeted refreshes, uses only OH catalog/inventory for every portfolio, and persists scores mainly on `SalesOpportunity`.
- The engine reuses the original detection product while refreshing the score/title, rewrites active/snoozed pursuits, and closes a pursuit on the first subsequent purchase. Detection snapshots themselves are preserved.
- `opportunityIntelligence.ts` saturates category volume at 60 physical bottles and account volume at 120; `opportunityAffinity.ts` uses 750 ml equivalents and saturates comparable volume at 24. Positive strategic priority is primarily eligibility.
- Product detection is dominated by existing-category displacement. Research-only fit counts venue/review proxies and cannot identify a market-specific product independently of OH inventory.
- The scheduled workflow already orders catalog, sales, inventory, then intelligence. Its intelligence condition permits execution after an inventory failure; availability must therefore retain explicit uncertainty. The legacy ledger only inserts missing keys, so corrections/deletions require reconciliation before pruning.
- Lists, detail/agency rollups, dashboard, search and research queues reference pursuit scores. They must read current assessments; historical pursuit scores remain historical evidence.

## Implementation contract

Use a tenant/account unique `WholesaleAccountAssessment` for current state, JSON versioned evidence/candidates, numeric priority, evidence mode, effort, and timestamps. `WholesaleAssessmentRun` records actual persisted coverage and a renewable tenant lease. A new evaluation never creates tasks or mutates chosen/closed/dismissed pursuits. Accepting a recommendation deliberately creates or reuses one pursuit and the existing contextual task workflow. Dismissal and snooze remain explicit human decisions.

The pure deterministic model separates observed 30/60/90-day physical bottles and 750 ml equivalents from supported use hypotheses. Capture requires compatible category/style/price and excludes protected local incumbents. Develop requires product/use evidence beyond low volume. Deepen permits existing tenant buyers with a supported use. Account priority is the strongest candidate's attention heuristic, never a sum, probability, forecast, revenue or profit. A bounded strategy multiplier affects attention only. Research-only scoring uses exact-location, dated evidence, buyer access and a supported use; it has no sales-data ceiling. Unknown distribution produces qualification. Review counts, ratings and venue amenities never become volume.

The initial model does not estimate additional volume without explicit buyer inputs. All quantitative purchase figures are observations, never consumption. Economics remain unavailable when absent. Learning is shadow only; initial purchase, distinct reorder dates, sustained windows and observed change are separate outcomes without causal claims.

Reuse the post-import orchestration, with a score-only CLI. Reconcile committed retained daily reports into the ledger before pruning. Select the latest committed effective date rather than the requested historical backfill date; still rerun corrected same-day reports. Batched account reads include unassigned, no-purchase, research-only and all pursuit states. Coverage derives from report completion and identity resolution. Missing dates are unavailable, completed zero-row reports are valid. Per-account failure persists run counts; per-tenant failure does not stop other tenants. No scoring imports a research provider or updates research observation timestamps.

Additive schema only. Echo's nullable strategy defaults can be initialized to Focus for active rum/rye/bourbon/Elusive and Opportunistic for vodka. Existing explicit priority/strategy conflicts are reported and preserved. Other tenants remain neutral. Product market decisions remain authoritative; non-OH fallback portfolio has unverified distribution, never inferred OH availability.

## Verification and delivery

Meaningful pure-model, coverage/ledger, lifecycle, batching and failure tests; representative old/new comparison including the reported low-volume conditions; typecheck, regression suite, optimized build and release check. Apply only this reviewed additive migration to a host-verified isolated TST database; full score-only sweep reads saved research. Verify mobile 390 x 844, desktop and TST deployment. Keep unavailable runtime evidence explicit. Production promotion and stable tags are outside scope.
