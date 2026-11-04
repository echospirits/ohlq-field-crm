# Neat UI/UX Guidelines

Canonical design and interaction standard. Revised November 4, 2026, following the [guideline audit](design/ui-ux-guidelines-audit-2026-11-04.md). This revision defines the direction for subsequent interface work; it does not establish that the application already meets it or open a development/release cycle.

Neat should be visually appealing, immediately understandable and efficient to operate. A salesperson should be able to recognize an account, see what matters and act without reading an explanation of the screen. A manager should be able to compare records without opening them one at a time.

**Expose useful data through hierarchy, alignment and concise labels. Remove repeated prose, oversized containers and redundant controls before moving useful information behind tabs, menus or expansion controls.**

## 1. Authority and design freedom

- Preserve product truth, permissions, canonical workflows, reliable behavior and user context. Existing colors, cards, spacing, navigation arrangements and component appearance are open to redesign.
- Reuse tested shared behavior and semantics. Improve or replace a shared component centrally when its presentation prevents a better experience. Reuse is an engineering strategy, not a requirement to retain the current look.
- This document governs new design decisions. Older design audits and descriptions of the current implementation are historical evidence, not reasons to reproduce that implementation. Current release records and authorization govern available features and delivery scope.
- Keep Neat's identity and established workflow names. Pipeline owns account sales progress; Log Visit owns manual interaction capture; account Contacts owns relationships; Worklist owns tasks and next actions. Follow [ADR 0012](decisions/0012-integrate-existing-workflows.md).
- Do not add a competing component framework or isolated page theme to bypass shared design work. Document deliberate exceptions with the task, constraint and evidence that justify them.

## 2. Priorities and information visibility

When requirements compete, prioritize accurate and accessible information, fast recognition and comparison, an obvious next action, preserved context, then reduced interaction cost. Visual craft supports all of these.

Before laying out a surface, name its primary task and the facts required to perform it. Classify information by its use in that task, rather than by its database field name or whether an input is optional.

| Information | Default treatment | Examples |
| --- | --- | --- |
| Working facts | Visible in the main view, beside the relevant record or decision | Identity, decisive comparison values, owner, urgency, next commitment, useful contact details |
| Material exceptions | Visible where they change interpretation or action | Overdue work, failed calendar sync, stale forecast, incomplete source coverage |
| Supporting depth | One clearly named disclosure or detail destination, with a useful summary | Full scoring method, long history, provenance details, raw IDs that are not needed to identify the record |
| Infrequent controls | Secondary action, overflow or separate setup area | Imports, reassignment, destructive actions, advanced configuration |

- Required working facts must be readable without opening a disclosure, action menu or edit form in the default task view. A rare exception needs an explicit task-based rationale.
- Choose a compact working set, not the smallest possible quantity of visible data. A count, date, tag or comparison may be the decisive fact; do not hide whole field categories by policy.
- Show important saved information as a read view with a separate Edit action. Do not make an editing form the only way to discover populated profile, territory, objective or plan information.
- A populated view may need more information than an empty view. Remove repeated empty placeholders, but preserve `Unassigned`, missing coverage and other absences that affect decisions.
- First improve labels, alignment, columns, repetition and spacing. Then decide whether supporting detail needs disclosure. Keeping all data on one screen is not a goal when it harms legibility or task focus.

## 3. Visual direction: Echo's craft, adapted for Neat

Use a precise, approachable working interface with Echo character. Favor strong alignment, readable type, compact data, fine rules and selective color. Avoid generic stacks of oversized rounded cards, decorative gradients, large introductory banners and marketing-style typography in daily work.

The source is **Echo Spirits Identity Guide, August 2017**, supplied at `I:\Shared drives\Echo Spirits\Branding and Design\Echo Spirits Identity Guide August 2017.pdf`. Page numbers below refer to PDF pages. The owner selected an adaptation for Neat. The guide is brand reference material; its marketing directions do not override the product's usability, accessibility or workflow requirements.

### Palette and meaning

| Brand source, PDF page 19 | Hex | Neat application |
| --- | --- | --- |
| Copper | `#885731` | Principal brand accent; primary action and selected emphasis where contrast permits |
| Patina | `#40C1AC` | Supporting accent, selected fills and limited chart emphasis; use a darker derived shade for text on light surfaces |
| Chalkboard | `#283138` | Principal text and strong structural contrast |
| Slate Gray | `#7C878E` | Source neutral; derive accessible secondary text rather than assuming this swatch passes |
| Smoke Gray | `#C1C6C8` | Quiet separators and neutral structure, subject to contrast needs |
| Fog Gray | `#DDDDDD` | Subtle neutral fills and separation |
| Crimson | `#E03C31` | Sparse attention accent; derive accessible error/destructive treatments |

- Use light neutral canvases and clear content surfaces, with Chalkboard text. Copper leads the brand accents and Patina supports it, following pages 19-20. Large neutral areas should stay quiet enough for data and actions to stand out.
- Treat these as source swatches, not a ready-made accessible UI theme. Define semantic tokens for canvas, surface, text, muted text, border, action, selection, focus, success, warning and danger, including interactive states and both supported themes.
- Brand identity and operational meaning are separate concerns. Patina must not automatically mean success, Copper must not mean warning, and every chart must not reuse the same accent for unrelated categories. Pair meaningful status color with text or a recognizable symbol.
- Test actual foreground/background combinations. Do not place white small text on Patina or use pale source grays as body text without a passing contrast measurement.
- Avoid color quotas per screen. The brand appears through consistent application, not by inserting every swatch into every view. Do not flood an operational page with Crimson.

### Typography, structure and finish

- Echo's values on page 7 translate into refined hierarchy, meticulous data alignment, friendly language and dependable interaction. Pages 21-22 favor a hardworking, glance-readable sans serif, restrained small-cap accents and legible sentence-case body text.
- Interstate is the guide's typeface. Use it only if appropriate web rights, font files and loading behavior are confirmed. Otherwise use a suitable available sans serif consistently. Do not block visual improvement on procuring a font or assume a desktop license permits web use.
- Starting scale, expressed as rem tokens: page title 24-28px equivalent, section title 18-20px, body and controls 14-16px, secondary labels 12-13px. Prefer 16px mobile form text. These are design starting points; test actual font metrics and larger text. Never shrink important data into tiny captions to fit more columns.
- Use weight, alignment and spacing to establish hierarchy. Limit all-caps treatment to short section or column labels where it remains readable. Keep record names, sentences and action labels in natural case.
- Right-align comparable numbers and use tabular numerals. Keep dates, units and number precision consistent. Emphasize a few decision-driving values rather than making every metric a large tile.
- Use a shared spacing scale based on 4px and 8px increments. Start with 8-12px within compact groups and 16-24px between distinct working areas. Reserve larger gaps for a real change of context.
- Use modest corner radii: roughly 4-8px for controls and work surfaces, with larger radii reserved for overlays where useful. Use borders and tonal separation before shadows; reserve elevation for surfaces that actually float.
- Pages 20 and 23 support deliberate negative space, organizing rules and simple one-color icons. Translate these into clear grouping and occasional restrained dotted brand rules. Use quiet solid row separators in dense tables; avoid decorative dots in every cell.
- Keep icons consistent, familiar and secondary to information. Do not import packaging textures, bottle-label ornament, giant display numbers or decorative photography into operational layouts. Preserve supplied logo artwork, proportions, safe areas and minimum sizes if it is used; never squeeze a complex mark into a tiny control.

## 4. Page composition and responsive behavior

- Design phone field tasks first at 390 x 844, and deliberately compose desktop review at 1440 x 900. Desktop must use its available width for useful comparison; it should not be a narrow phone layout with extra margins.
- Put identity/title, necessary scope, the principal action and a compact search/filter toolbar above the working area. Start useful data in the first viewport. Do not require a screenful of introductory copy, filters, metric tiles or closed sections before the records begin.
- Use a content grid with consistent column edges. Put related facts on the same row or in aligned columns. Reserve cards for a distinct working area or self-contained decision, rather than wrapping each field, navigation item or disclosure in a box.
- Let data views use available width. Constrain reading measure for substantial prose, not for comparison tables. Use side-by-side panels on desktop only when they support related work without making either panel unusable.
- Mobile field views retain the information needed for lookup, preparation, contact, directions, visits and follow-ups. Advanced maintenance can have a separate destination; useful operational facts must not disappear merely because the screen is narrow.
- Reflow structurally: consolidate identity/location, prioritize columns, wrap concise secondary facts and move navigation when necessary. Do not convert every table cell into a tall labeled block or hide columns through broad positional CSS.
- Prevent unintended horizontal page scrolling. When a comparison truly requires two dimensions, use a labeled, keyboard-accessible table region with contained overflow and a visible indication that more columns exist. Keep identity and essential field facts available without lateral hunting wherever practical.
- Sticky headers or action bars must earn their space, avoid obscuring content/focus and account for mobile safe areas and the on-screen keyboard. Do not stack sticky bars until they consume the viewport.

## 5. Tables and record browsing

**Repeated records with comparable attributes default to a semantic table or an aligned compact list.** Cards and boards are alternatives for tasks that benefit from them, not automatic replacements for tabular browsing.

- Choose columns from the task. Put record identity first, then the values used to compare or prioritize, with related row actions close by. Show units and shared periods in headings rather than repeating a sentence in each cell.
- On desktop, share column headers across rows. Align dates and numbers consistently; use stable column widths, concise statuses and enough separation to track a row. Use a subtle hover/selection treatment without making static content look interactive.
- On mobile, retain identity, decisive values and the relevant quick action in compact rows or a prioritized table. Consolidate secondary facts without erasing their meaning. Provide a comparison view when cross-record comparison is the job.
- Start desktop comparison rows around 40-48px high, allowing wrapping where necessary. Mobile rows can contain two or three purposeful lines and must preserve 44px targets for frequent actions. Density comes from less repetition and better layout, not clipped names, illegible type or crowded controls.
- Provide relevant sorting, visible sort direction, live search, clear active filters, result counts and an honest continuation path. Display the current scope near the result set, even when advanced filter controls are closed.
- Keep the common filter controls in a compact toolbar. An additional filter area may be disclosed, but active filters and a clear/reset path remain visible. Do not hide the result-changing sort or scope without showing its current value.
- Preserve query, filters, sort, page and return/scroll context when a user opens a record and returns. Make URL state and browser Back useful where appropriate.
- Use a real link for the record destination. Whole-row click behavior is optional; it must preserve keyboard access, text selection and distinct embedded controls. Do not nest links/buttons or require hover to discover an action.
- Use semantic table headers and accessible sort controls. Only offer bulk selection/actions when the workflow supports them; show scope and affected count and preserve authorization checks.
- Use bounded server pagination for substantial datasets. Sorting and totals must describe the intended filtered dataset, not quietly rank only the visible page. Loading must not erase the active query or reset the user's position unnecessarily.

## 6. Copy and disclosure

### Remove explanation that layout can replace

- Page and section descriptions are optional. Omit text that restates the heading, tells users to use an obvious control or explains how the page was implemented.
- Prefer an accurate label, unit, date, status or local qualifier over an explanatory paragraph. Put meaning beside the value it qualifies. Keep only text that changes a decision, prevents a likely error or explains recovery.
- Do not remove material warnings or source limits to make a screenshot cleaner. Compress their presentation while preserving their meaning and prominence.
- Start routine helper text at one short sentence. Longer help belongs near the unusual choice or in a named help area. Successful saves usually need a concise confirmation; explain next steps only when there are real consequences.

| Verbose or hidden presentation | Preferred treatment |
| --- | --- |
| A paragraph explaining that the list can be searched and filtered | Search field, visible filter labels and result count |
| Task status, decisive details and sync errors inside `More task actions` | Readable task context and error beside the task; infrequent editing actions in the menu |
| A paragraph explaining the horizon and quantity unit of every forecast | Shared horizon and column labels such as `Outbound cases`; a local source/uncertainty qualifier |
| Populated account objectives discoverable only by opening an edit form | Compact objective/target summary plus `Edit plan` |

### Disclose supporting depth deliberately

- Disclose long history, full methodology, raw provenance, infrequent setup and genuinely advanced inputs. Keep decisive evidence and material uncertainty in the main view; the fact that something is called evidence does not make it secondary.
- A closed section must communicate what is inside and, when useful, its count or meaningful current value. A generic `Details` label is insufficient when the contents can change the next action.
- Overflow menus contain actions, not important current data. Dropdowns select values; they are not a substitute for displaying a record's facts. No nested disclosure should be required to complete a frequent task.
- Optional fields are not automatically hidden. Keep frequently used optional fields visible; defer the rarely used ones. Already populated important values remain visible even if their inputs are optional.
- Tabs suit substantial, distinct work areas. They must not fragment a small related working set just to reduce visible content. Preserve deep links, browser history, form state and a meaningful summary of important cross-tab work.

## 7. Navigation, actions and context

- Use stable names across navigation, headings and links. Keep frequent field destinations easy to reach and administrative destinations secondary. Close transient menus after navigation. Avoid intermediate routing pages when a combined search or filtered destination can do the job.
- Existing navigation can be reorganized to improve the task. Preserve valid destinations, authorization, deep links and return context; keep retired features retired.
- Establish one clear page-level action hierarchy. Use restrained row actions for repeated operations rather than a visually dominant button on every card. Keep frequent useful actions exposed and infrequent ones in overflow.
- Label actions by their result: `Log visit`, `Create follow-up`, `View task`, `Get directions`. Icons may supplement familiar actions; ambiguous icon-only actions need a clear accessible name and visible clarification when necessary.
- Clearly distinguish links, actions, editable fields, disclosures, disabled controls and static information. Explain unavailable actions briefly where the reason matters; use `View task` instead of a dead `On worklist` control when the task exists.
- Carry reliable account, contact, product, task, owner, recommendation and return context into actions. Prefill known values, show a compact context summary and allow a deliberate Change action. Return to the originating workflow on completion or cancellation.
- Separate destructive actions from frequent positive actions. Use precise labels and confirmation or Undo proportionate to the consequence.

## 8. Search, selection and forms

- Search updates after a short debounce; Enter may submit but should rarely be required. Preserve focus and ignore superseded results. Build on `LiveFilterForm` behavior while improving its shared presentation where needed.
- Search relevant names, IDs, city, address, contacts and phone within authorization scope. Favor exact identity matches. Explain indirect matches only when the result would otherwise be confusing.
- Show loading, result count, clear/reset and no-results states. Make capped results and pagination explicit. Default account selection to relevant recent results where available; Nearby requires an understandable location choice.
- Use searchable pickers for long account, contact, product and owner lists. Show enough identity to distinguish similar records. Use inline choices for short meaningful sets; a native select is appropriate for short stable lists. Do not replace every small select with a custom widget.
- Ask for what the action needs and use reliable, reversible defaults. Keep required and frequently used fields visible; reveal conditional fields when relevant. Preserve labels, input values and user context after errors.
- Validate near the field, identify the first error, prevent duplicate submissions and communicate pending state. Keep the submit action reachable in long mobile forms without covering inputs.
- Prefer an inline read/edit pattern for a small change. Use a dialog or sheet when it preserves the surrounding task; use a full page for substantial work. Preserve focus management and keyboard behavior in every case.

## 9. Workflows and data trust

- Worklist leads with actual work grouped by Overdue, Today, Upcoming and Unscheduled. Distinguish My work, team work and unassigned work. Keep due date, ownership, decisive task detail and actionable failures visible; place task creation behind a compact action when work already exists.
- Provide quick Complete and Reschedule actions where authorized. Explain whether a contextual visit/follow-up also completes its source task, and preserve calendar side effects, idempotency and history.
- Account views expose useful relationship context, contacts, outstanding commitments and known saved facts. Keep Call, Email, Text, Directions, Log Visit and follow-up actions close to the context that motivates them.
- Recommendations expose account, product/opportunity, decisive reasons or comparison values, next action and material data-quality limits. Full scoring methodology can be secondary. Carry supporting context into a task without placing a long explanation above editable fields.
- Initiating a call, email or text does not prove completed contact. Nonphysical contact is never a physical visit. Placement commitment, verified placement, order and sustained purchasing remain distinct facts.
- Missing, partial, stale and unavailable data are not zero. Label units, time windows and observation/sale/import dates accurately. Show source freshness near the relevant dataset; put full lineage in supporting depth. Do not invent confidence or predictive accuracy.
- Resolve user and organization on the server. Reorganizing visible information must preserve tenant, role, state and feature boundaries, including private counts and summaries. Support access does not authorize private mailbox data.

## 10. States, accessibility and speed

- **Loading:** Preserve layout, query and context; mark updating regions busy. Use restrained skeletons or clear loading text rather than blank areas or repeated spinners.
- **Empty:** Distinguish no records, no matching records, no assigned work and unavailable source data. Offer the relevant recovery action without a long tutorial.
- **Error:** Explain what failed and how to recover, preserve entered work and show material failures beside the affected task/data. Avoid raw internal errors in the main message.
- **Success:** Confirm the saved object and important side effects with accessible inline feedback or a toast. Prevent duplicate saves; keep a useful return path.
- **Disabled:** Explain the meaningful prerequisite concisely. Show an unavailable state rather than a dead destination.
- Target WCAG 2.2 AA. Use semantic landmarks, headings, labels, links, buttons, tables and dialogs; meaningful accessible names; logical keyboard order and visible focus. Communicate selection/status without color alone and announce important updates without unnecessary chatter.
- Keep frequent mobile targets at least 44 x 44 CSS pixels with separation. This is Neat's field-use standard, stronger than the [WCAG AA target-size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html); density must not remove it.
- Verify normal text contrast of at least 4.5:1 and qualifying large text at least 3:1 using the [contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Verify non-text controls/focus contrast as applicable. Muted text still needs to be legible.
- Test text enlargement and [reflow at 320 CSS pixels](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), with contained exceptions only for genuinely two-dimensional content. Dialogs/popovers must remain reachable, escape clipping, manage focus and return focus appropriately.
- Use short, purposeful state transitions. Respect reduced-motion preferences with useful feedback; avoid page-load choreography and decorative motion.
- Keep search/navigation responsive with bounded reads, appropriate pagination and limited client work. Avoid heavy decorative assets, duplicate hidden data views and avoidable layout shifts. Visual redesign must not discard the existing performance safeguards or claim unmeasured speed gains.

## 11. Shared implementation strategy

Use the current source as the behavior inventory, then improve its shared presentation. Candidate building blocks are capabilities, not a requirement to create components with these exact names:

| Shared capability | Starting points and required direction |
| --- | --- |
| Page/section chrome | `PageChrome`: compact heading/actions, optional description, useful count/scope/freshness placement |
| Record browsing | Existing directory, Worklist, Pipeline and Forecast tables/lists: aligned columns, responsive priorities, consistent filters, sort, pagination and actions |
| Contextual account/workspace | `AccountWorkspace`, account briefing and contextual actions: retain state/deep links, expose useful saved facts, separate read and edit |
| Search and pickers | `LiveFilterForm`, `RecordPicker` and existing account search: shared feedback, identity and keyboard behavior |
| Status and freshness | Existing badges and data-quality components: consistent semantic vocabulary and visible material exceptions |
| Supporting detail and overlays | Existing details/dialog/sheet patterns: specific summaries, correct focus, no operational facts hidden in action menus |

Consolidate semantic tokens and stylesheet ownership as each authorized surface is migrated. Remove superseded rules within that scope rather than appending another broad override layer. Check light and dark themes, callers and adjacent surfaces when changing shared primitives. Do not create unused abstractions or use the document as authorization for unrelated feature work.

## 12. UI Definition of Done

For each implementation, provide a short surface record with the primary task, required facts, matched before/after screenshots, representative task steps and verification limits. A visual change cannot pass solely because tests pass or the page has no overflow.

- [ ] The primary task and decision-driving facts are named. Those facts and material exceptions are visible in the default task view; every remaining disclosure or destination change has a reason.
- [ ] Useful records/data begin in the first viewport at 390 x 844 and 1440 x 900. Toolbars, introductory copy and oversized containers do not displace the work.
- [ ] Matched populated screenshots use the same scope, data, viewport and theme. Record visible working facts, usable rows, task clicks and disclosure openings before/after. Set task-specific improvement targets; explain tradeoffs rather than maximizing raw density.
- [ ] The result shows a material improvement in hierarchy, data comparison or interaction cost. A promised visual overhaul changes shared typography, spacing, surfaces or color meaningfully; recoloring unchanged containers alone is insufficient.
- [ ] Repeated records use a justified table/list/card/board treatment. Desktop supports comparison, mobile retains decisive facts and neither relies on tiny text or unintended page overflow.
- [ ] Routine explanatory prose and repeated labels have been removed or replaced by local labels/qualifiers. Important warnings and source limits remain clear.
- [ ] Common actions are obvious, usable by touch and keyboard, close to their data, and preserve known context and return state. Search, filters, sort, pagination and browser Back behave consistently.
- [ ] Long names, realistic row counts, missing values, true zeros and exceptional statuses have been checked, alongside loading, empty, error, disabled and success states relevant to the change.
- [ ] Light/dark themes, contrast, keyboard/focus, touch targets, text enlargement and narrow reflow have been checked. Screenshots and automated checks are not claims of full accessibility conformance.
- [ ] Authorization, data semantics, persisted behavior, canonical workflows and performance safeguards are preserved. Run the affected checks and delivery gates required by `AGENTS.md` and the release process.
- [ ] Evidence distinguishes source review, fixtures, automated checks, observed browser behavior and human acceptance. Report unresolved limits honestly; do not claim task-speed gains without measuring them.

For substantial redesigns, resolve the visual direction on representative populated mobile and desktop surfaces before applying it broadly. Use those surfaces to validate the shared system, then migrate the remaining inventory consistently under the separately authorized implementation scope.
