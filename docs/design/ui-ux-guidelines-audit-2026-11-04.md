# Neat UI/UX guideline audit - November 4, 2026

## Scope and conclusion

This is a document and source audit supporting the overhaul of [the canonical guidelines](../UI-UX-GUIDELINES.md). The reviewed policy is the 150-line version at `304b68ca1e4de7cd821f8696b67e847bef37b3c4`; old-policy line references below refer to that version. Source references describe the checkout inspected during this audit, not fresh hosted acceptance.

The policy plausibly contributes to incremental visual change. It repeatedly rewards reuse and disclosure, but does not require important saved data to remain visible, define a visual direction, or demonstrate improved browsing. It cannot establish the sole cause of the reported experience. Implementation choices, accumulated styles and incomplete acceptance criteria also matter.

The owner authorized step 1: overhaul the guidelines, adapting Echo Spirits' identity for Neat. Step 2 applies that standard across the application. This audit delivers policy direction and a scoped implementation sequence; it does not deliver redesigned screens or open a release cycle.

The method adapts Impeccable audit, critique and Operate guidance to a policy document. Markdown detection would not meaningfully test rendered UI. No new live browser session, timed user task, keyboard/screen-reader audit or performance measurement was conducted. No numeric design-health or WCAG conformance score is claimed.

## Prioritized findings

### P1 - Disclosure is treated as an outcome rather than a tradeoff

Old policy lines 14-15 prioritize minimum information and progressive disclosure. Lines 74, 92 and 101 move evidence, comparisons, identifiers, tags and counts out of view. Line 147 makes disclosure a completion criterion. None requires an inventory of the facts a user needs before opening anything.

Source examples:

- `app/components/AccountProfile.tsx:68-105` collapses saved profile, territory and team information together with editing controls.
- `app/components/AccountSalesPlan.tsx:30-74` similarly collapses objectives, target products and the plan form.
- `app/alerts/page.tsx:391-404` passes operational task detail as evidence; `app/alerts/WorklistActions.tsx:111-124` puts it and calendar synchronization errors inside `More task actions`, labeled for editing, reassigning or canceling.

Impact: information needed to understand the current state shares a hiding place with infrequent modification actions. A user must discover the container before knowing whether its contents matter.

Replacement: show a compact read view of important populated facts, with editing opened intentionally. Keep decisive task detail and actionable failures visible. Disclose long methodology, raw metadata, historical depth and infrequent controls. Optional input does not automatically mean hidden input.

### P1 - Data browsing lacks a strong default and loses useful columns

Old policy lines 23, 98, 100 and 134 favor mobile rows/cards and reserve tables primarily for desktop comparison. Line 101 encourages moving secondary attributes to detail. These are reasonable options, but the policy never tests whether a field is actually secondary for the task.

Source examples:

- `app/workspace-foundation.css:47-49` unconditionally hides directory IDs, addresses, city, phones, tags, logged visits and Next Action. This is outside the later media query, so the hiding also applies on desktop.
- Restaurants still renders Next Action in `app/wholesale/page.tsx:593`; the available columns are declared at lines 87-97.
- Pipeline defaults to a list in `app/pipeline/page.tsx:33`, but repeats status, owner, activity, purchase, follow-up and attention labels per record at lines 134-149. `app/redesign.css:441-455` presents a nine-column article grid with `.7rem` labels.

Impact: some density comes from removing useful information, while other views spend space repeating labels. Similar-looking rows are harder to compare than aligned cells under shared headings.

Replacement: use semantic tables or aligned compact lists for repeated comparable records. Choose default columns by the decision being made. Preserve decisive mobile facts through concise cells and deliberate column priority; use contained horizontal comparison where the task needs it. Small text and indiscriminate field removal are not density improvements.

### P1 - The existing implementation is granted too much visual authority

Old policy lines 27, 54 and 123-134 favor existing navigation, behavior and named primitives. It does not distinguish valuable behavioral reuse from visual preservation. The component list gives more concrete direction than the visual standard itself.

Source examples:

- `app/styles.css:1-25` specifies the incumbent ivory/olive palette and 18px radius; lines 56-58 specify Inter/system sans and a 15px base.
- `app/layout.tsx:11-16` imports several overlapping style layers, including redesign, theme, field-workspace and foundation styles. Later layers repeatedly restyle cards and tables.
- `docs/design/design-system.md:5` reinforces existing cards/buttons and forms. `docs/design/mobile-experience.md:5` repeats cards/compact rows and disclosure.

Impact: an implementation can satisfy the policy by recombining the same containers and styles. Another override layer can create superficial change without a coherent system.

Replacement: preserve tested behavior, semantics, context and workflow ownership while permitting substantial shared presentation changes. Define brand-derived tokens, typography, spacing, table treatment and surface hierarchy centrally. Reuse means improving the shared system, not protecting every old visual decision.

### P2 - Explanatory copy has no space budget or removal test

Old policy lines 31, 70 and 79 request context, next steps and explanation, but do not distinguish useful interpretation from habitual introductory text. There is no requirement to remove prose that labels, units or visible state could replace.

Source examples:

- `app/components/PageChrome.tsx:14,36` renders page and section descriptions whenever supplied.
- `app/pipeline/page.tsx:100,115` adds generic instructions before the records.
- `app/analytics/production/page.tsx:22-24` combines a page description with a planning paragraph.

Impact: headings and explanation consume the space that could expose records or decisive facts. Frequent users repeatedly scan text that no longer teaches them anything.

Replacement: make heading descriptions exceptional. Prefer exact labels, units, date windows and short local qualifiers. Keep necessary warnings near their consequence; place extended help behind an intentional help action. Never remove uncertainty or safety information merely to shorten copy.

### P2 - Validation proves mechanics more readily than visual improvement

Old policy lines 142-150 check viewports, overflow, clear actions, context, search, states and accessibility mechanics. They do not require better exposure of data, easier comparison, fewer disclosure openings or an identifiable visual change.

`docs/releases/0.5.0-ui-validation.md:7` describes a practical acceptance sample. Its fixture scope at lines 28-29 covers navigation, planning, events and briefing with mock records/actions. Those checks are useful, but do not establish that every important fact is discoverable or comparable.

The named `field-workspace-*` captures were unavailable in the inspected `output/playwright` directory. Older committed screenshots do not establish the released 0.5.0 visual state. Source findings above are not a substitute for fresh populated screenshots.

Replacement: capture matched before/after screens and representative task paths. Record decisive visible facts, comparable rows, interaction count and remaining disclosure cost. Set task-specific targets before implementation; do not invent a passed human usability test afterward.

## Strengths to preserve

- Known-context carryover and return paths, old policy lines 45-49, prevent repeated searching and entry.
- Live search with result/loading/empty states, lines 53-59, supports field work.
- Visible labels, retained input and local validation, lines 68-70, protect user work.
- Worklist ownership and task/visit semantics, lines 83-87, preserve canonical workflows.
- Unknown versus zero, freshness and truthful statuses, lines 94 and 104-111, protect data trust.
- Semantic controls, focus management, contrast and touch targets, lines 115-119, remain required.

Existing source provides useful foundations: `AccountWorkspace.tsx:7-8,33,35-56` preserves mounted state, deep links/history and keyboard tab behavior; `AccountBriefingView.tsx:17-28` exposes relationship dates, next action and reasons while leaving scoring methodology secondary. The Worklist table at `app/alerts/page.tsx:356-389` already aligns account/task, due date and owner.

## Echo identity adaptation

Reference: *Echo Spirits Identity Guide, August 2017*, supplied by the owner. The step-1 review read all 28 pages and visually inspected PDF pages 7 and 19-23. Document content is design evidence, not an independent instruction to change application behavior.

| Source | Relevant evidence | Adaptation for Neat |
|---|---|---|
| Page 7 | Refined, curious, meticulous, friendly, genuine, dynamic | Precise data presentation, approachable copy and purposeful interactions |
| Pages 19-20 | Copper `#885731`, Patina `#40C1AC`, Chalkboard `#283138`, Slate `#7C878E`, Smoke `#C1C6C8`, Fog `#DDDDDD`, Crimson `#E03C31`; Copper dominant, Patina accent, sparse Crimson, negative space | A restrained shared palette; role and contrast determine use rather than placing every color on every screen |
| Pages 21-22 | Interstate typography; small-cap accents and legible sentence-case body text | Crisp typographic hierarchy; usable data and controls take precedence; font files, web licensing and suitability require verification |
| Page 23 | Rules and icon language | Fine dividers and consistent functional iconography rather than decorative containers |

Neat remains the product identity. The guide informs character and craft; bottle-label, advertising and marketing-page compositions are not templates for an operational workspace. Exact brand colors do not automatically meet contrast requirements in every role. Semantic status colors remain distinct from brand decoration.

## Step 2 sequence

1. **Capture a baseline and choose tasks.** Use populated Accounts, account detail, Worklist, Pipeline and Forecast examples. Establish the decision, required facts and representative mobile/desktop task before changing layout.
2. **Set shared visual foundations.** Map the adapted identity to centralized tokens and shared components. Consolidate ownership of overlapping styles within the authorized scope. Establish compact headings/toolbars, restrained surfaces, readable type and aligned numbers/dates.
3. **Improve record browsing.** Start with directory column visibility and the existing Worklist table, then Pipeline and Forecast. Preserve filters, sort, pagination, return context and alternate views that serve a real task.
4. **Expose saved account information.** Separate compact profile/plan summaries from editing. Keep next commitments and material exceptions visible; reserve expansion for supporting depth.
5. **Remove repeated prose and validate.** Audit descriptions, helper paragraphs and per-cell explanation. Replace repetition with labels and local qualifiers, then verify real task paths and state coverage.

This sequence is an implementation proposal. It does not authorize production promotion, unrelated features, migrations, provider activation or changes to tenant/role boundaries. Follow the current repository release process when step 2 is authorized.

## Acceptance evidence for step 2

- Name each surface's primary decision and required facts; distinguish initially visible facts from intentionally deferred detail.
- Capture matched populated states at 390 x 844 and 1440 x 900, with enough records, long names, missing values and exceptions to expose real layout behavior.
- Record comparable rows per viewport and primary-task interactions before/after. Explain remaining expansion, menu opening and destination changes; judge changes against the preselected task rather than a universal density quota.
- Verify that desktop exposes useful comparison columns and mobile retains decisive facts without unintended page overflow. Keep essential table overflow contained and understandable.
- Show the shared visual changes in typography, hierarchy, color and spacing. A token change alone does not establish improved usability.
- Verify keyboard/focus behavior, readable contrast, text enlargement, touch targets and relevant loading, empty, error, disabled and success states. Screenshots alone do not establish accessibility conformance.
- Preserve input, search/filter/sort state, task/account context and return position where applicable. Confirm private data and counts remain authorized.
- Identify whether each result comes from source review, automation, a fixture, a live environment or observed human use. Keep unperformed human/device acceptance explicitly pending.

Completion of this document review establishes a stronger standard for the next implementation. It does not establish that the application already meets it.
