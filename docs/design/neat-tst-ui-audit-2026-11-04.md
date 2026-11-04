# Neat TST UI audit and implementation - November 4, 2026

## Scope, baseline and status

The owner authorized applying the revised [UI/UX Guidelines](../UI-UX-GUIDELINES.md) across **neat-tst**, with main and production excluded. This is the `0.7.0-dev` upgrade work. It preserves the existing 0.6.0 forecasting and Operational Signals behavior; it does not approve a production release.

The source baseline is `ef41fe8fb5810dd52cadfecab09dd4d8d995a829` (`staging/tst` when the upgrade began). The observed production/main baseline is `4f39e5b89703373c6730d2d590e3262da93c6648`. Work is isolated on `codex/neat-ui-upgrade-20261104`; historical release and candidate records remain preserved. Deployment and final candidate evidence belong in the version-specific release validation record.

Inventory command: `rg --files app -g 'page.tsx'`. It found **46 page entrypoints**. The route tables below account for every entrypoint, including compatibility redirects and routes whose existing structure is retained. API routes and background jobs are behavior/security dependencies, not additional visual page entrypoints.

Method: three independent source-audit workstreams covered field data (`field_data_ui`), daily work (`daily_work_ui`) and analytics/administration (`analysis_admin_ui`). The root review covered the shared visual system, navigation, responsive behavior and integration. The method adapts Impeccable's audit, critique, Operate and craft guidance to an existing application with an owner-approved design direction. It is not a formal numeric Impeccable health score.

**Local browser verification is complete.** Thirteen actual-component fixtures pass at 390 x 844, 1440 x 900 and the observed in-app size 742 x 668 in light and dark themes (78 final combinations). Separate 320px/enlarged-root-text and hydrated filter-reset checks also pass. These are representative fixture scenes, not a live acceptance run of every page query, role, provider action or persisted write. Exact results and TST delivery are recorded in [release validation](../releases/0.7.0-validation.md). No timed user-speed improvement or full accessibility certification is claimed.

## Findings and disposition

Line references in the baseline column refer to the pre-upgrade commit above. Current implementation links point to working source and may move during integration.

| Priority | Finding and user effect | Baseline evidence | Implementation disposition |
| --- | --- | --- | --- |
| P1 | Useful directory columns were removed at every width, making compactness depend on missing data. | `app/workspace-foundation.css:47-49` hides IDs, location, phone, tags, visits and Next Action outside the mobile media query. | Shared comparison treatment restores useful task columns. Retail/restaurant rows keep identity, location and next-action context; responsive priorities replace blanket positional hiding. See [directory source](../../app/wholesale/page.tsx) and [shared foundation](../../app/workspace-foundation.css). |
| P1 | Saved account facts were discoverable through editing and nested disclosure. | `AccountProfile.tsx:68-105`; `AccountSalesPlan.tsx:30-74`; the sales-status editor contained the plan component. | [Profile](../../app/components/AccountProfile.tsx) and [plan](../../app/components/AccountSalesPlan.tsx) show compact read summaries in account Overview. Editing is separate. Existing account tabs, deep links and form-state behavior are preserved. |
| P1 | Worklist context and calendar errors shared an action overflow container. | `app/alerts/page.tsx:391-404` and `WorklistActions.tsx:111-124`. | Task status, source and decisive detail are in the [row](../../app/alerts/page.tsx); [calendar sync failures](../../app/alerts/WorklistActions.tsx) remain visible outside overflow. Infrequent reassignment/cancellation and audit detail can remain secondary. |
| P1 | Stock and sales evidence needed to judge a product opportunity was hidden. | `app/agencies/AgencyIntelligencePanel.tsx` placed on-hand, minimum, 7/30-day sales and fit values in `View evidence`. | [Product/inventory comparisons](../../app/agencies/AgencyIntelligencePanel.tsx) expose working values and useful columns; full reasoning remains secondary. Product-fit and restaurant opportunity browsing use aligned comparisons. |
| P2 | Similar records repeated labels or used oversized containers instead of shared comparison structure. | `app/pipeline/page.tsx:134-149` repeats labels; `app/redesign.css:441-455` arranges article cards; forecast renders separate desktop/mobile records. | [Pipeline](../../app/pipeline/page.tsx), intelligence, visits and administration use semantic comparison tables. [ForecastTable](../../app/analytics/production/ForecastTable.tsx) renders each product once, with all eight comparison columns and a responsive mobile arrangement. |
| P2 | Explanatory copy, metric tiles and forms displaced operational records. | `PageChrome.tsx:14,36`; Forecast page description plus planning paragraph; Data Status leads with an open refresh form and source cards. | Compact page metadata and optional descriptions; metric strips; [source overview before refresh controls](../../app/admin/data-status/page.tsx); concise local units, periods and qualifiers. Material warnings and source limits remain. |
| P2 | Existing palette, large radii and overlapping presentation rules limited the visual change. | `app/styles.css:1-25` uses the ivory/olive palette and 18px radius; `app/layout.tsx` imports multiple presentation layers. | Copper/Patina/Chalkboard semantic themes, smaller radii, consistent typography and flatter working surfaces are centralized in [theme](../../app/theme.css), [base styles](../../app/styles.css) and [foundation](../../app/workspace-foundation.css). Shared behavior is reused while appearance changes. |
| P2 | Some daily work required opening sections before seeing relevant scheduling data. | Schedule event disclosure and mobile overdue/undated tray treatment. | [Schedule events](../../app/events/ScheduleEvents.tsx) and the [mobile overdue/undated tray](../../app/my-week/WorklistScheduler.tsx) expose the work; creation and deeper planning controls remain secondary. |
| P2 | Missing historical evidence could read as a stronger business conclusion. | Buying-state label `Never purchased`; Pipeline's next-action presentation needed explicit overdue/undated treatment. | Integration uses `No recorded purchase` for absent retained purchase evidence and displays overdue/unscheduled facts explicitly. The correction changes presentation, not purchase inference, task queries or the forecasting model. |

## Route inventory and implementation outcomes

### Accounts, Pipeline, Worklist and intelligence - 12 entrypoints

| Route | Outcome and retained behavior |
| --- | --- |
| `/accounts` | Preserve authenticated routing to Search, or Log Visit for Tasters; no redundant account-choice screen. |
| `/agencies` | Retail comparison browsing with useful columns, compact identity/location and existing search, sort, pagination and contextual links. |
| `/agencies/[id]` | Account Overview includes saved profile/plan read summaries and useful signals; Contacts, Worklist, history, permission gates and canonical actions remain. |
| `/wholesale` | Restaurant comparison browsing with next-action and location context; retain scoped filters, ranking semantics and pagination. |
| `/wholesale/[id]` | Saved profile and plan are readable in Overview; keep contacts, commitments, existing account workspace and source limits. |
| `/wholesale/[id]/edit` | Retain the existing canonical account edit form and validation; shared theme/control improvements apply. No new edit route or save behavior. |
| `/wholesale/[id]/merge` | Retain the existing guarded merge workflow and consequences; shared theme applies. No merge was submitted by this audit. |
| `/wholesale/[id]/direct-order` | Concise contextual order presentation and known account information; preserve reviewed order submission, units and return destination. |
| `/pipeline` | Semantic account comparison table; explicit owner, activity, purchase evidence, next action and attention facts. Keep the alternate board and canonical stage behavior. |
| `/alerts` | Worklist status/source/detail, due date, owner and actionable sync failures are visible; quick actions preserve task/account context. |
| `/agency-focus` | Retail Intelligence comparison table with useful product/account evidence, freshness and contextual actions. No scoring changes. |
| `/opportunities` | Restaurant opportunity comparison table for commercial fit, observed compatibility, coverage and actions. Preserve model limitations and tenant/state scope. |

### Schedule, visits and events - 7 entrypoints

| Route | Outcome and retained behavior |
| --- | --- |
| `/` | My Schedule leads with daily work; event/staff scheduling and relevant overdue work are visible. Creation and deeper planning remain secondary. |
| `/my-week` | Retain week scheduling/drag and task behavior; expose the mobile overdue/undated tray and use the shared visual standard. |
| `/visits` | Semantic Visit History comparison with useful filters and visible scope; retain the existing authorized account timeline projection elsewhere. |
| `/visits/new` | Known account/context and contact chips are visible; preserve canonical Log Visit, drafts, validation, follow-up consequences and return paths. |
| `/visits/[id]/edit` | Existing visit editing uses the improved shared Log Visit form/control presentation; authorization and persisted semantics remain. |
| `/visits/confirmed` | Retain confirmation and relevant return/next actions; shared theme applies. No new completion or contact semantics. |
| `/events/[id]` | Compact read summary for date/location/status/staff, plus event sales comparison. Editing and provider/history depth remain intentional secondary areas. |

### Orders, directories and personal settings - 9 entrypoints

| Route | Outcome and retained behavior |
| --- | --- |
| `/wholesale-orders` | Compact browsing and concise context; preserve order state, source identity and account links. |
| `/wholesale-orders/new` | Existing contextual order form with shorter copy and shared control treatment; no order automation added. |
| `/wholesale-orders/[id]` | Retain order detail, downloads and actions; shared theme applies. Stored order history and document semantics remain. |
| `/tags` | Tag comparison browsing precedes the creation form. Existing counts, account associations and actions remain authorized. |
| `/tags/[id]` | Tagged-account comparison precedes secondary maintenance controls; preserve links and associations. |
| `/users` | Team roster browsing precedes invitation/creation controls; role/access state and guarded administration remain. |
| `/search` | Concise combined record search and useful identity; retain live search, result behavior, role scope and contextual destinations. |
| `/profile` | Concise profile/appearance presentation using the shared theme. Existing preferences, save behavior and identity remain. |
| `/settings/calendar` | Concise calendar status/setup copy; preserve connection state, warnings and independent Worklist synchronization behavior. |

### Analytics and administration - 11 entrypoints

| Route | Outcome and retained behavior |
| --- | --- |
| `/analytics` | Compact metric strips, semantic comparison tables and visible continuity/relationship reports. Active scope is readable; product selection no longer requires nested filter disclosure. Definitions remain secondary, data-quality warnings visible. |
| `/analytics/production` | One responsive product table; visible horizon/search/market/confidence/sort, immediate-demand estimate/source state and separate statistical targets. Compact warehouse comparison keeps stale/failed observations honest. |
| `/analytics/production/[id]` | Compact forecast summary and period/location/DC comparison tables; current demand and delivery follow the main summary/alerts. Full historical methods and saved histories remain secondary. |
| `/analytics/production/settings` | Visible saved account/mapping summary; fixed warehouse IDs submit unchanged as hidden fields while addresses display as static information. Preserve credential autofill protections and guarded explicit verification/check actions. |
| `/admin/account-research` | Exposed failure queue before research controls, compact summary, shorter guidance and preserved cost/availability limits. Existing inline correction and manual CSV workflow remain. |
| `/admin/data-status` | Source comparison before import controls; daily error/warning text visible, raw diagnostics secondary. Missing last-load row count is unavailable, not fabricated zero. |
| `/admin/environment` | Retain safe deployment/database identity and side-effect summary; remove generic introductory copy and apply shared compact styling. No secrets displayed. |
| `/admin/opportunity-performance` | Semantic comparison treatment with aligned numbers and contained overflow; preserve historical-label and association/causation limitations. |
| `/admin/organization` | Current product strategy shown as a read table with contextual editing; retain legitimate disclosure for infrequent configuration and all guarded save actions. |
| `/admin/user-activity` | Semantic user/date/access comparison with UTC labels, compact summaries and existing filters/pagination. Access counts are not measures of work quality. |
| `/admin/weekly-digest` | Compact preview/send controls and delivery-log comparison. Keep recipient scope, duplicate-send behavior, unavailable actions and sending consequences clear. No email was sent by this audit. |

### Authentication, review and compatibility - 7 entrypoints

| Route | Outcome and retained behavior |
| --- | --- |
| `/login` | Shared theme and concise brand/header presentation; preserve authentication, pending/error states and safe return handling. |
| `/reset-password` | Shared theme/control presentation; retain reset validation, token/error states and security behavior. |
| `/accept-invite` | Shared theme/control presentation; retain invitation identity, token validation and account-activation behavior. |
| `/contact-import/review` | Shared theme applies to the existing review flow; retain account/user-bound token validation, explicit review and invalid/expired states. |
| `/deals` | Preserve authenticated compatibility redirect to Pipeline; no standalone Deals workflow. |
| `/deals/[id]` | Preserve authenticated compatibility redirect to Pipeline. |
| `/activities` | Preserve authenticated redirect to the contextual account timeline, or Log Visit when no valid context exists. |

## Representative tasks and source-derived disclosure costs

The counts below describe required openings in source structure from a loaded default workspace, when the relevant authorized data exists. They exclude navigation into the record, scrolling, network time and user reading time. They are not measured human task times. Browser checks must confirm that the rendered result matches the structure.

| Task | Required working facts | Baseline openings | New main-view treatment |
| --- | --- | --- | --- |
| Prepare an account visit from its saved plan | Stage, objectives, target products and saved planning assumptions | 2: Update status, then Account plan | 0: saved plan read summary in Overview; editing separate |
| Check account ownership/territory before acting | Saved category, territory, team and relevant populated profile facts | 2: Details tab, then profile disclosure | 0: compact profile read summary in Overview |
| Understand a Worklist commitment | Account, task, decisive detail, status/source, owner and due/urgency | 1: More task actions for operational context | 0: working context in row; infrequent actions/audit depth remain secondary |
| Decide whether a product needs attention | On-hand, minimum, observed recent sales, fit and current data state | 1: View evidence for stock/sales values | 0: aligned comparison values; full reasons remain secondary |
| Compare forecast products | Selected horizon, forecast/range, immediate-demand estimate, target, prior-year comparison, trend, guidance and confidence | Desktop/mobile records duplicated; mobile supporting facts required per-record disclosure | One semantic record per product; compact mobile arrangement retains working and comparison facts |
| Review source import health | Source, loaded count, last success, current warning/error and reporting date | Open refresh form/source cards preceded daily results; errors could require disclosure | Source comparison first; warning/error text visible; diagnostics secondary |

Pipeline now shows overdue and unscheduled actions explicitly while retaining the previous future-only attention inputs. Purchase absence reads `No recorded purchase`, with underlying historical states/IDs preserved. Final fixtures include missing values, known zero, retained stale estimates and exceptional statuses alongside populated healthy records.

## Shared design and safeguards

The implementation adapts the supplied Echo identity rather than copying bottle-label or marketing layouts: Copper for principal brand actions, Patina-derived supporting emphasis, Chalkboard structure/text, quiet neutral surfaces, clear sans-serif hierarchy, fine rules and modest radii. Light/dark themes use semantic tokens; source brand swatches are not assumed to pass every contrast pairing. Existing shared primitives are improved centrally rather than replaced with a competing framework.

Preserved requirements:

- Server-resolved user/organization and existing tenant, role, state and feature boundaries, including private summaries and counts.
- Pipeline, Log Visit, Contacts and Worklist ownership; compatibility routes do not create duplicate workflows.
- Account/contact/product/task/owner context, deep links, return destinations, mounted form state, validation, idempotency, history and calendar side effects.
- Initiation versus completed contact, physical visit semantics, observed purchase versus planning assumptions, and unknown versus true zero.
- Forecast 30/60/90-day models, source-line exclusions, Operational Signals estimation and independent freshness/retention semantics. Immediate demand is never added to a statistical forecast or target.
- Bounded pagination/read behavior, existing query/model logic and provider/credential protections. Views continue to read saved operational observations instead of initiating source checks.
- Visible labels, semantic controls/tables, focus treatment, touch targets and appropriate loading/empty/error/disabled/success feedback. Screenshots cannot establish every keyboard/screen-reader requirement.

No database migration, dependency upgrade, provider activation, hosted setting change or business-model change is part of this UI work. Shared-TST CRM writes, credential changes, calendar actions, merges and email sends are not implied by fixture rendering.

## Verification checkpoint and remaining acceptance

- Source inventory and the three workstream audits are complete; the 46 entrypoints above have explicit dispositions. A retained route is an intentional outcome, not a claim that its hosted state was exercised.
- Analytics/admin focused checks covered 106 unique tests. The obsolete assertion requiring duplicate mobile/desktop forecast links was updated to one responsive record while retaining organization/filter assertions. The final access rerun passed 6/6; final research/forecast-presentation rerun passed 15/15. Retained semantic UI tests cover current/stale/retained/zero/unavailable demand and bounded warehouse observations.
- Full regression suite: 997 tests in 74 suites, zero failures/skips. Strict typecheck, optimized build, schema validation and diff checks pass. Dependency graphs and schema/migration/workflow trees are unchanged; package versions advance only to 0.7.0-dev. One mechanical scan reported three contextual legacy warnings, with disposition documented in release validation.
- Thirteen actual-component fixtures pass at all three observed/required viewport sizes in both themes. Final enlarged-text/narrow checks pass. Hydrated history filters reset all five pickers and both date fields, restore records, allow reselection and return focus on Escape. Saved working facts and source-derived disclosure costs are documented above. An omitted component stylesheet initially caused false Pipeline markers in fixtures; corrected captures supersede those images.
- Independent behavioral review's three findings (picker reset, paused calendar status and phone target size) are fixed and scored resolved. The finish review's listed reflow/sort, fixture styling and direction-provenance fixes are also scored resolved; its ship disposition applies to that fix list, not unlimited whole-app acceptance.
- Authenticated hosted TST checks passed across ten representative routes, with phone, desktop and default in-app observations. Exact populated/empty states, read-only interactions and the one Analytics loading-wait limit are recorded in release validation. Every applicable role/data/state combination, physical phone acceptance and observed human task success remain bounded acceptance items; exhaustive coverage is not claimed.
- Application commit `a9d850380e90caceebc3f3376d4e294b293216a3` is pushed to `staging/tst`; deployment `dpl_BUSsZKRcKBmPWEWv931sCBViDvzz` is **READY**, health verifies `test / neon-neat-tst / connected`, and freshly fetched main remains `4f39e5b89703373c6730d2d590e3262da93c6648`. See the [TST receipt](../releases/0.7.0-validation.md). Later receipt-only commits do not alter the verified application source.
- The owner approved the redesigned TST interface and requested main promotion. Stable 0.7.0 is selectively deployed to production candidate `5023578de6bfda370ea547af7b1cb5494bbdfe70`, with READY/production health, exact-candidate CI and authenticated mobile/desktop acceptance recorded in [release validation](../releases/0.7.0-validation.md). Earlier TST-only boundaries and main-unchanged observations above are historical delivery receipts. Unrelated TST maintenance remains excluded; development is frozen without a new cycle.
