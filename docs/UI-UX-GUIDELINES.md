# Neat UI/UX Guidelines

These are the canonical interaction and presentation standards for Neat. Apply them to every user-facing feature and use the UI Definition of Done before considering the work complete.

Neat is primarily a phone tool for salespeople working between accounts. Desktop supports deeper review, comparison, configuration, and administration. Optimize first for a rep who has limited time, one free hand, and context the application may already know.

## Core priorities

When requirements compete, prefer this order:

1. Make the next useful action obvious.
2. Preserve known account, contact, product, task, and return context.
3. Reduce taps, page changes, scrolling, and repeated entry.
4. Show the minimum information needed to decide and act.
5. Preserve depth through progressive disclosure and desktop layouts.

## Mobile and desktop responsibilities

- Design the phone experience first at a common narrow viewport such as 390 x 844. The primary task must remain usable without horizontal page scrolling.
- Emphasize search, today's work, account context, contact actions, directions, visit logging, follow-ups, and order entry on mobile.
- Keep bulk maintenance, imports, configuration, wide comparisons, diagnostics, and detailed analysis on desktop or clearly de-emphasized on mobile.
- Do not force identical layouts across screen sizes. Preserve capabilities that matter in the field and move supporting detail behind disclosure or to desktop.
- A wide table may scroll inside its own labeled container on desktop. On mobile, use compact rows or cards unless horizontal comparison is essential; never make the document itself wider than the viewport.

## Navigation and page hierarchy

- Use the existing application navigation, breadcrumbs, account-view navigation, and work-view navigation before adding new navigation patterns.
- Keep mobile primary navigation limited to frequent field destinations. Put infrequent and administrative destinations under More, and close menus after navigation.
- A destination should have one stable name throughout navigation, headings, links, and empty states.
- Render section navigation only for sections that exist. If a section is temporarily unavailable, show a clear unavailable state rather than a dead link.
- Start each page with: where the user is, what matters now, and what they can do next. Put supporting description and historical detail afterward.
- Avoid routing pages that merely ask the user to choose a data type when one combined search or filtered destination can do the job.

## Actions and affordances

- Give each page or card one visually dominant primary action. Use secondary buttons for frequent alternatives and an overflow menu for infrequent actions.
- Label actions with the result: `Log visit`, `Create follow-up`, `View task`, or `Get directions`. Do not rely on an unlabeled plus, ambiguous icon, or generic `View` when the result is not obvious.
- Keep actions close to the information that justifies them. If Neat surfaces a contact, task, recommendation, product, or account, let the user act there without searching again.
- Distinguish links, buttons, editable fields, disclosures, disabled controls, and static text through consistent styling and semantics. Do not make static cards look tappable or hide editing behind vague labels.
- Explain why an action is disabled and what makes it available. Replace disabled state labels such as `On worklist` with a useful action such as `View task` when the related object already exists.
- Use clear destructive labels such as `Cancel task`; separate destructive actions from frequent positive actions.

## Known context and contextual actions

- Carry forward every reliable value Neat already knows: account, contact, product, source task, recommendation reason, owner, and return destination.
- Prefill contextual forms and display a compact summary with a `Change` or `Edit` action. Do not repeat the same context in multiple large cards.
- Return users to the originating workflow after completing or canceling a contextual action.
- Put relevant Call, Email, Text, Directions, Log Visit, Create Follow-up, Complete, and Reschedule actions on the account, contact, task, or recommendation where they are needed.
- Opening a phone or email application is an initiated action, not proof that communication occurred. Status and activity language must preserve that distinction.

## Search and account selection

- Search should update as the user types after a short debounce. Enter may submit, but should rarely be required.
- Use the existing `LiveFilterForm` behavior as the baseline and consolidate global search and account/customer pickers on the same interaction pattern.
- Search names, IDs, city, address, contacts, and phone where relevant. Rank exact name and ID matches first, then recent and nearby accounts when those signals are available.
- Explain indirect matches when the visible result does not contain the search term.
- Show clear loading, result count, no-results, and Clear search states. If results are capped or paginated, make that explicit and provide a continuation path.
- Prefer one searchable account picker with Agency and Wholesale filters over separate routes or large native selects. Show enough identity to disambiguate similar accounts: name, type, city/address, and ID when needed.
- Default an empty picker to recent accounts; offer Nearby only with an explicit, understandable location choice.

## Forms, defaults, and dropdowns

- Ask only for information required to complete the current action. Put optional and advanced fields behind `Add details` or reveal them when a preceding choice makes them relevant.
- Use smart, reversible defaults based on context: current user, current account, sensible follow-up date, known customer information, and known product pricing. Clearly expose how to change them.
- Keep the first editable field and the primary submit action easy to reach. Use a persistent mobile action bar for long, high-frequency forms.
- Prefer chips for small mutually exclusive sets, searchable comboboxes for large datasets, date shortcuts for common scheduling choices, and inline toggles for simple states.
- Avoid native selects for long account, contact, product, or owner lists. A select is appropriate only when the list is short, recognizable, and stable.
- Keep labels visible; mark optional fields consistently. Placeholder text may provide an example but must not be the only label.
- Validate near the field, retain entered values after errors, focus or scroll to the first error, and prevent duplicate submissions while saving.
- On success, state what happened and what happens next. For consequential workflows, offer a relevant next action or return path.

## Progressive disclosure, density, and spacing

- Show the decision summary first; place evidence, setup guidance, raw metadata, and long history behind descriptive disclosures such as `Why this recommendation?` or `More account details`.
- Collapse empty or low-value sections. Do not stack repeated zero-value cards when one concise state conveys the same information.
- Keep field-facing rows compact enough to scan several records per screen. Use whitespace to separate decisions and action groups, not every individual field.
- Avoid nested cards when a heading, divider, or compact row communicates the hierarchy. Do not turn every desktop table cell into a labeled mobile block.
- Preserve important safety or workflow explanations, but keep them concise and place extended help behind a Help or Learn more disclosure.

## Worklist and task interactions

- Lead with actual work, grouped by Overdue, Today, Upcoming, and Unscheduled. Make My work, team work, and unassigned work visibly distinct.
- Put task creation behind a compact `Add task` action when tasks already exist; do not make the creation form the first screen of the worklist.
- Provide one-tap Complete and quick Reschedule actions, with accessible confirmation or Undo where appropriate.
- Show relative urgency such as `Overdue 3 days` alongside the exact date when useful. Display `Unassigned` explicitly rather than leaving ownership blank.
- When a task starts a visit or follow-up, retain task and account context and clearly state whether completing the new action also completes the source task.

## Intelligence and recommendations

- A recommendation summary should show the account, target product or opportunity, one or two decisive reasons, the recommended next action, and confidence or data-quality context.
- Put scoring details, peer comparisons, model evidence, and long explanations behind `Why this recommendation?`.
- Keep the primary action visible without requiring the user to read the complete evidence. Carry supporting evidence into the created task without placing it above editable fields.
- Distinguish a true zero from unavailable, incomplete, updating, or stale intelligence. Never present missing inputs as a healthy zero.

## Lists, cards, and tables

- Use compact linked rows for mobile browsing. Put the record identity first, then one or two decision-making facts and the relevant quick action.
- Use cards for self-contained decisions or actions, not as a mechanical replacement for every table row.
- Use tables on desktop when users need to compare the same attributes across records. Choose useful default columns and allow secondary columns to be hidden or configured.
- Omit empty secondary fields from mobile rows. Move IDs, tags, counts, and metadata to detail views unless they help identify or prioritize the record.
- Make the entire row clickable only when it has one clear destination and the styling communicates that behavior; keep embedded actions large and distinct.

## States, feedback, and data trust

- **Loading:** Keep the page structure stable, mark updating regions busy, and use plain text or skeletons that describe what is loading. Do not leave unexplained blank space.
- **Empty:** Say whether there is no data, no matching data, no work assigned, or a required source is unavailable. Provide the next useful action, such as clearing filters, logging a first visit, or checking data status.
- **Error:** Explain what failed, preserve the user's work, and offer a safe retry or recovery path. Do not expose raw internal errors as the main message.
- **Success:** Confirm the saved object and important consequences. Use inline confirmation or a toast announced to assistive technology, and prevent accidental duplicate saves.
- **Freshness:** For imported or computed data, show `Through <date/time>` and use a consistent basis for time windows. Label observation, detection, sale, and import dates accurately.
- **Status:** Use shared status labels and badges with consistent wording, color, and semantics. Status must never rely on color alone.

## Accessibility and touch

- Use semantic headings, landmarks, buttons, links, labels, tables, and dialogs. Provide `aria-current`, `aria-expanded`, `aria-busy`, and live announcements where they describe real state.
- Every control needs an accessible name that describes its action. Decorative icons must be hidden from assistive technology.
- Maintain visible keyboard focus and logical focus order. Dialogs must have a labeled title, support Escape, manage focus, and return focus to their trigger.
- Make frequent mobile touch targets at least 44 x 44 CSS pixels with enough separation to avoid accidental activation.
- Meet WCAG AA color contrast and communicate validation, selection, urgency, and status with text or icons in addition to color.

## Shared UI primitives to standardize

Build on existing components rather than creating one-off variants:

- **PageHeader / SectionHeading / EmptyState:** Extend the existing `PageChrome` primitives for consistent hierarchy and actionable empty states.
- **LiveSearch:** Generalize `LiveFilterForm` into the standard debounced search, loading, result-count, clear, and no-results pattern; use it for global, directory, account, and customer search.
- **AccountPicker:** Searchable account selection with recent results, type filters, clear identity, and optional nearby behavior.
- **AccountHeader:** Compact identity, location, primary contact, last touch, next action, and contextual action group.
- **ContextualActions / QuickActionSheet:** Consolidate the existing contextual action menu and mobile sheet behavior, including known-context summaries, consistent headers, feedback, and focus management.
- **MobileActionBar:** Persistent primary submit or high-frequency actions for long mobile workflows.
- **EditableField:** Consistent read/edit affordance, inline validation, Save/Cancel, and success feedback for small account fields.
- **StatusBadge / DataFreshness:** Shared semantic statuses plus current, updating, unavailable, and stale data labels.
- **CollapsibleSection:** Consistent disclosure for optional forms, evidence, setup guidance, and secondary account detail.
- **CompactRecordRow:** Mobile list row for accounts, tasks, orders, and recommendations; use responsive table wrappers only when comparison requires a table.

Do not create a component solely because a name appears here. Standardize it when a feature encounters the repeated pattern, and migrate nearby duplicate implementations when that work is reasonably scoped.

## UI Definition of Done

For every user-facing feature, verify that:

- [ ] The primary workflow works at 390 x 844 and at a representative desktop viewport.
- [ ] The page has no unintended horizontal scrolling; any necessary table overflow is contained.
- [ ] The primary action and the clickability or editability of every control are clear.
- [ ] Known account, contact, product, task, owner, and return context is preserved and prefilled.
- [ ] Search updates live where the user is choosing or finding records.
- [ ] Optional fields and supporting detail use progressive disclosure.
- [ ] Loading, empty, error, disabled, and success behavior is explicit and accessible.
- [ ] Touch targets, keyboard focus, labels, and status communication are usable.
- [ ] Mobile is efficient for field work and desktop remains functional for deeper work.
