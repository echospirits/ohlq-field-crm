# Field interface redesign

The September 2026 direction uses warm ivory surfaces, dark readable text, olive primary actions, quiet sage selection states, and restrained clay warnings. The shared stylesheet covers all existing routes; page-specific layouts retain their existing data and action contracts. Organization colors remain available as tenant accents.

## Information hierarchy

| Area | New presentation | Preserved capabilities |
| --- | --- | --- |
| Home | Search and the signed-in user's next four tasks lead; intelligence and team reporting are disclosures | Every intelligence category, agency signal, team metric, worklist and weekly-calendar link |
| Worklist | Overdue, Today, Upcoming, Unscheduled and Finished groups; explicit team, personal and unassigned scopes | Category/source/status/search filters, task creation, completion, visit logging, rescheduling, reassignment, editing, cancellation and calendar status |
| Accounts | Contact and notes context, compact actions, secondary details behind a labeled disclosure | Agency and wholesale identity, IDs, tags, merging, editing, directions, contacts/import/export, notes, placements, purchase history, intelligence and activity |
| Visits | Notes precede optional outcome selection; optional details stay collapsed; mobile save bar remains reachable | All outcome codes, account selection, contacts, task resolution choices, follow-ups, assignment, voice notes, photos, account creation and Taster flow |
| Search and directories | Consistent live search, lighter linked rows, restrained navigation | Existing matching, filters, sorting, pagination and account-type destinations |
| Orders and administration | Shared light surfaces, readable statuses and touch targets | Order creation/PDF/status flows, organization settings, role gates, diagnostics, data operations and integrations |

No schema, order calculation, import, email-delivery, tenant authorization, or production configuration changes are part of this redesign. It is published to the dedicated `neat-tst` repository's `tst` branch only.

## Interaction details

- Navigation retains all existing destinations, with labeled icons on mobile. More closes after navigation.
- New account pickers search the full supplied options before limiting visible suggestions.
- Task metadata is available through Task details; cancellation and reassignment sit with the secondary editing controls.
- Account section links open their target disclosure when needed.
- Task and follow-up dialogs trap keyboard focus, support Escape, and return focus to their trigger.
- Loading, empty, error, disabled and success presentations use the same surface and text hierarchy.
- Small status labels keep text as well as color. Reduced-motion preferences disable animation.

Follow `UI-UX-GUIDELINES.md` when extending these patterns. Mobile presentation should remain useful with actual records and long names, not just demonstration data.
