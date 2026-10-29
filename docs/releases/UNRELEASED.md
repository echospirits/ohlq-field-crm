# Frozen release candidate — 0.5.0

Opened October 28, 2026 for the owner-approved interface mockups, desktop navigation consistency, and compact account briefing. Production has since advanced through the separately authorized 0.4.1 performance hotfix and **0.4.2** forecast download hotfix ([release receipt](0.4.2-validation.md)); the owner has now explicitly authorized the completed interface/audit release to main. [Development plan](0.5.0-plan.md), [pending release checklist](0.5.0-checklist.md), [validation](field-workspace-validation.md). Promote only the exact tested 0.5.0 candidate after its release gates pass.

- Opening production: `f7f5d8012751f79875e3f6d0999dc28ad02cb926` (0.4.0).
- Opening TST: `cc8b47d217a79ab0a7bab0c679ad02f5833bbd8b` (0.4.0); opening trees match.

## Changes

### Compact browsing and section hierarchy

- Schedule route planning, events, insights and shared optional sections use text, chevrons and dividers instead of oversized white collapsed cards. Directory and intelligence rows use the same hierarchy; meaningful form surfaces remain distinct.
- Generic Log visit moves into mobile More, preventing floating controls from covering Pipeline, Forecast and administrative content. Mobile buttons and disclosures retain a 44px touch floor; More supports Escape and closes after navigation.
- Retail Intelligence renders 25 recommendations per page instead of 250; restaurant opportunities render 25 instead of 50. Pagination is visible above and below results, preserves filters and action-return pages, and search resets to page one. Supporting metrics and pursuit preferences remain available through disclosures.
- Pipeline keeps search visible and collapses optional territory/team filters. Directory summaries show known contact, visit and rating information without repeated unrecorded metadata. Forecast product search stays visible, and Sources/Import links open their target sections.
- Validation: 898 passing tests, strict typecheck and credential-free actual-component fixtures at 390 x 844 and 1440 x 900 in light/dark themes. Fixtures cover native disclosure, missing-history evidence, mobile More, overflow and touch targets; live saves/providers are not inferred. Final deployment and release evidence is recorded separately.

### Application-wide interface and browsing performance

- Owner subsequently authorized a whole-application audit and production release. Shared headers, disclosures, empty states, focus treatment and mobile touch targets follow one ivory/olive system. Redundant heading labels and duplicate floating visit actions are removed from finding/selection flows.
- Retail and ordinary restaurant browsing use 50-record server pages with stable order and filter-preserving Previous/Next links. Restaurant account creation moves below results with an Add account shortcut; search and sorting remain available. Explicit computed ranking sorts retain their bounded complete-sort path so rankings are not calculated from a single page.
- Pipeline opens on its account list, uses compact status filters and keeps populated board stages open. Forecasting product search stays visible on mobile; source uncertainty and freshness remain visible. Older retail, restaurant, visit and tag controls receive associated labels.
- Layout and page authentication reuse an in-flight session read only within the same request and cookie. New requests revalidate durable access; no shared identity/data cache is introduced.
- Validation: full suite/type/build and bounded mobile/desktop confirmation recorded in the final 0.5.0 audit/release evidence. No schema, migration, hosted environment or entitlement changes are required by these improvements.

### Production source download repair — released separately as 0.4.2

- Match Bailment's actual `From`/`To` date labels, retaining the existing date labels for other reports; verify the requested dates remain selected. Wait for Partner DC's positive unfiltered table count and displayed rows before capturing export completeness, so its initial zero-row loading shell cannot reject a valid full CSV.
- Add safe report-control and export-stage diagnostics plus a TST-only live download acceptance check using existing scoped credentials. It validates complete native reports without importing facts or refreshing forecasts; raw reports and screenshots remain private runner-temporary files.
- Validation: live TST downloads and the actual production import/refresh passed. Production has 6,001 demand observations, 60 guidance observations and 19 numeric eligible forecasts with no duplicate demand identities. [Source download validation](production-source-download-validation.md), [production receipt](0.4.2-validation.md).
- Released under separate owner authorization as `v0.4.2` at `5143a53a`. No migrations, credential/configuration changes or additional recurring schedule. Existing OHLQ concurrency is preserved. These source fixes are already in both trees and must not regress during 0.5.0 promotion.

### Navigation and account performance

- Account pages start independent reads concurrently and show loading indicators for secondary panels. Identity-only reads no longer load the account directory solely to authenticate or read scalar organization settings. Nested account selections and writes retain state enforcement.
- Validation and limitations: [performance validation](0.5.0-performance-validation.md). Production latency improvement has not yet been measured.
- Migration, backfill, environment/configuration and feature flags: None. The account performance changes were separately released to production as 0.4.1 at `91cd60f4`; the field-workspace changes below join the newly authorized 0.5.0 release.

### Field workspace, account sections and useful briefings

- Description and user-visible behavior: Consistent grouped desktop navigation; named account tabs replace stacked placement/purchase/intelligence disclosures. Overview leads with Notes, Contacts, Outstanding work, and a compact briefing. Unrecorded facts are omitted, one empty state replaces repeated missing-data rows, and relationship evidence remains available. Mobile account Log Visit/Directions preserve context. Worklist leads with account identity, live search, named advanced filters and relative urgency. Empty schedules show a concise personal state and separate unassigned team work. Visit forms keep optional detail secondary and Save/Cancel reachable.
- Worklist search now also matches linked restaurant and retail account names before applying the result cap, including legacy retail references and tenant-scoped source-visit follow-ups. Existing task text, owner, status and feature filtering remain in force.
- Relevant TST commit(s): `Refine Neat field workflows and account sections` and scoped validation/documentation follow-up; final delivery commit recorded in validation.
- Validation and known limits: Full test/type/build, responsive and keyboard/deep-link/form-preservation evidence in [validation](field-workspace-validation.md). Fixture feedback is distinct from live backend/provider acceptance. No temporary admin session is created in shared TST.
- Migration, backfill, environment/configuration and feature flags: None. Preserve tenant scoping, existing role/feature gates, canonical server actions, historical records and Worklist/calendar effects. Communications and other retired features remain retired.
- Release/recovery notes: additive to released 0.4.2. No database rollback is required; promote only the tested 0.5.0 tree.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
