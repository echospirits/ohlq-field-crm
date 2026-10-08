# Wholesale account intelligence — 0.14-dev

Contracts: `WHOLESALE_ASSESSMENT_V1`, `WHOLESALE_EVIDENCE_V1`, `WHOLESALE_OUTCOME_V1`. See the [implementation audit](wholesale-assessment-v1-design.md) and [TST validation](releases/0.14.0-wholesale-assessment-validation.md).

## What priority means

Priority is a deterministic 0–100 heuristic for sales attention within an evidence mode. It is not measured demand, conversion probability, attainable bottles, dollars or profit. The highest justified candidate sets account priority; overlapping alternatives are never added. Account size, observed compatible volume, evidence confidence, product strategy and recommended effort are shown separately.

`lib/wholesaleAssessment.ts` owns the rules. Capture potential is `100 × compatible750 / (compatible750 + 120)`: equal-fit 60 and 600 equivalents yield 33.3 and 83.3 before feasibility/strategy. Capture requires at least six observed non-tenant 750 ml equivalents, compatible category/style, catalog price within 75–175% of the tenant product, and no protected local incumbent in that lane. These are discovery heuristics; catalog/price similarity never establishes an actual pour or attainable share. Prices are current catalog positioning, not historical invoice prices. OHLQ bottle sizes retain the existing fluid-ounce-to-liter conversion.

Develop requires a dated exact-location buyer plan, supported demand or trial; a current research-only menu use can support a qualification hypothesis. Low/zero purchasing alone is never evidence of untapped demand. Deepen permits an existing buyer with a supported product/use. Development potential is a bounded evidence rubric (65 for corroborated expansion, otherwise 40; up to 15 each for one direct scale fact and strong current cocktail-program context). Research freshness is 180 days. Review counts, ratings, patio and meeting-space proxies do not become volume. Generic cordial buying does not qualify Elusive, and unknown rum styles do not establish substitution. Premixed cocktails do not substitute for base spirits.

Feasibility uses confirmed local buyer access and capture continuity (at least three distinct report dates). Unknown access reduces attention and requires qualification; restricted/centralized buying retains the 20-point cap. Partial purchase coverage caps capture priority at 65. Weak or stale research caps non-capture priority at 60. Focus applies 1.12, Opportunistic/Neutral 1.0 and Maintenance 0.8; positive configured priorities 1–10 add up to 9%, bounded with role to 0.8–1.2. Priority 0 preserves exclusion. Maintenance is capped below 40. These adjustments never change observations. A strong vodka stream can outrank weak rum evidence.

Dedicated effort requires high supporting confidence, confirmed market availability and local buyer access. Otherwise qualify; weak opportunities can be mentioned during planned work. Relationship/reorder reminders remain separate from growth potential. Initial V1 has no attainable-volume or contribution estimator because supported quantities, capture assumptions and margins are absent. No synthetic dollars or category-growth forecasts are shown.

## Evidence and research-only behavior

Coverage is derived from completed report revisions, verified tenant ledger capture and license identity. Fully covered, unambiguous 90-day observations are SALES_BACKED; matched but incomplete data is PARTIAL_SALES. Accounts without a reliable sales source use RESEARCH_ONLY, including unmatched Ohio identities and non-Ohio locations. A verified zero requires all 90 dates and an unambiguous identity. Partial observed zeroes are never labeled verified zero. Observation windows are 30/60/90 days, never “annual” totals; recent change compares adjacent 30-day windows only with complete coverage.

Research-only candidates use saved exact-location, dated evidence and the relevant market portfolio. They have no low sales-data ceiling: strong supported uses can reach high research priority. Unverified distribution produces a qualification action, confirmed unavailability excludes, and absent Ohio inventory never excludes a non-Ohio portfolio. Exact market exclusions and ALL-market restrictions take precedence. Conflicting, stale, wrong-location or insufficient research produces visible qualification needs. Confidence describes the evidence, not an unobserved forecast.

The existing research prompt/schema now accepts `productUses` only when sourced. No historical backfill fabricates these facts. Menu placement editing adds optional use family, actually poured product and buyer plan/demand evidence; existing observation dates, sources, statuses and account identity remain authoritative. Menu wording and actual pour are distinct. Scoring itself neither invokes a provider nor changes research timestamps.

## Current assessment and human work

`WholesaleAccountAssessment` is unique by tenant/account and persists explicit READY, NEEDS_QUALIFICATION, SUPPRESSED or INELIGIBLE results even without a SalesOpportunity. The JSON preserves versioned explanations, alternatives and dates. Sorting groups evidence modes before comparing priority; equal scores across modes are not equal measured value.

Lists/search, wholesale detail, agency-linked wholesale summaries, dashboard counts, opportunity inbox and research-queue priority read current assessments. Existing Pipeline/Targeting workflows have no parallel wholesale score; digest work summaries retain chosen task context and do not introduce a second current score. Old pure scorers/learning utilities remain for historical analysis and compatibility tests only; live `opportunityEngine` delegates to the replacement service. Old per-pursuit numeric scoring UI is removed.

Acceptance is an explicit, serializable transaction: recheck tenant, candidate, dismissal/snooze, account eligibility and active tenant assignee; retain an existing chosen pursuit; otherwise freeze the current hypothesis and create one pursuit, task and detection/action/worklist events. Only unchosen legacy OPEN suggestions are retired during acceptance. The task uses existing Worklist identity and the existing calendar-sync hook; no calendar permissions/configuration change. Repeated/competing acceptance cannot duplicate the active account key. Calculation alone never creates tasks, updates detection snapshots, reopens dismissed work or rewrites active/closed pursuit targets. Recommendation feedback records wrong evidence/product, low upside, timing or strategy, separately from market demand.

## Daily operation and monitoring

The existing scheduled/import chain remains account/catalog → committed sales → tenant inventory → wholesale/agency intelligence → retention. Direct non-deferred imports also refresh inventory before scoring. An inventory failure leaves availability unverified and the import workflow unsuccessful; it is never interpreted as zero stock. Successful zero-row sales days still capture a revision and run the full sweep. The scheduled intelligence step requires successful sales import; failed sales require import recovery or an explicit score-only retry with partial coverage.

All enabled active tenants and non-merged accounts are evaluated, including unassigned/no-sales/no-pursuit and all lifecycle states. Queries use pages of 100 and batched tenant/account evidence reads, with four in-memory evaluations per batch and one bound-parameter SQL upsert per batch. A renewable unique tenant lease fences stale workers. Failed batches isolate failed rows and preserve actual persisted counts; tenant failure does not prevent attempts for other tenants. Historical dates cannot move current windows backward; wall-clock aging uses Eastern dates. Same-date report revisions replace that tenant/day ledger before certification. Requested historical backfills are captured before pruning. Already-pruned missing raw history remains unavailable.

`WholesaleAssessmentRun` records model/config hash, actual start/completion, window/effective source dates, missing dates, expected/evaluated/persisted/ineligible/failed counts and evidence-mode counts. `COMPLETED` means the applicable assessments finished. `PARTIAL_SOURCE` means persistence completed with partial sales evidence. `PARTIAL`/`FAILED` require score retry; `RUNNING` with an expired lease can be recovered by the next run. Administration → Opportunity Performance exposes these distinctions and the last full assessment refresh. A green GitHub run that skipped its schedule slot is not evidence of a refresh.

Saved research and menu evidence trigger bounded targeted refreshes; account identity edits mark all tenant assessments pending and refresh affected accounts. Product selection/strategy changes mark tenant assessments pending for the next daily sweep; operators can use score-only retry immediately. No statewide scoring runs in visit/task saves.

## Configuration, migration and commands

Migration: `prisma/migrations/20260929160000_wholesale_assessments/migration.sql`. It adds assessment/run/ledger-day tables, optional strategy/distribution and menu-evidence columns, and optional pursuit shadow outcomes. It preserves old snapshots and is compatible with the preceding application. Echo-only defaults apply Focus to active included rum/rye/bourbon/Elusive and Opportunistic to vodka only when both priority and role are unset; RTDs are excluded from this initialization. Existing explicit settings are preserved, other products are unchanged, and other tenants remain neutral. Edit market strategy in Organization Setup. No new environment variables, flags, provider permissions or learning activation.

Verify the **actual** linked TST project, fresh project environment, `APP_ENV=test`, `DATABASE_ENVIRONMENT=test`, `DATABASE_TARGET_ID`, test base URL, and exact database hostname against `EXPECTED_DATABASE_HOST` before any database command. Follow [environment isolation](environment-isolation.md). On legacy ledgers, apply only reviewed additive SQL and resolve only that migration after successful execution; never blindly run the historical migration chain, reset, or schema-push.

With a verified TST environment loaded:

```powershell
# Read-only; do not commit output containing account evidence.
npm run recalculate:opportunities -- --organization org_echo_spirits --account ACCOUNT_ID --output output/assessment-preview.json
# Whole population against preserved historical snapshots, plus hash-selected sample.
node --import tsx scripts/compare-wholesale-assessments.ts org_echo_spirits output/assessment-comparison.json
# Persist all enabled tenants, without imports or research.
npm run recalculate:opportunities -- --apply
# Optional bounded repair.
npm run recalculate:opportunities -- --organization org_echo_spirits --account ACCOUNT_ID --apply
```

The CLI defaults to dry-run, refuses production, reports errors per tenant and exits nonzero on incomplete persistence. `recalculate:opportunities:v6` is a compatibility alias to this same replacement, not a second model. Targeted evaluation itself never reads statewide raw rows; explicit CLI `--apply` may reconcile retained ledger first.

## Shadow outcomes and rollback

Learning contributes zero. `WHOLESALE_OUTCOME_V1` separately records initial observed purchase, distinct repeat dates, sustained 90-day windows when coverage supports them, and agreed/live placements. Two lines on one date are one purchase date. Missing report days cannot become negative examples; research-only accounts get no inferred sales outcome. Historical first-purchase conversion labels remain historical, not relabeled new training examples. Observed volume change is nullable until both baseline and comparison observations are supported; contribution is always unavailable without economics. No causal uplift claims.

For TST rollback, stop/avoid new assessment jobs and redeploy the prior tested TST application while retaining additive schema and audit history. Older software ignores new tables, but resuming its old intelligence writer would restore legacy behavior; keep that writer paused until the forward fix. Do not delete assessments, snapshots or ledger to roll back code. If a bad run only affected current assessments, fix the evaluator and run an idempotent score-only sweep. Production promotion requires a separately authorized frozen candidate, migration/coverage/config review, release checklist and deployment verification; this work does not authorize it.
