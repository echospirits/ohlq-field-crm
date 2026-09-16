# Button behavior audit — September 16, 2026

Reviewed 117 JSX button definitions across the application, including their parent forms or client handlers. This is a source audit of every definition, with browser validation of shared submission behavior and representative workflows; it is not a claim that every administrative or externally consequential action was executed.

## Fixed

- Worklist and My Week status saves invoked statewide opportunity recalculation after committing the task. Removed that work from the interactive request; the existing import pipeline remains responsible for recalculation.
- Task creation, completion, cancellation, editing, rescheduling, and reassignment waited for Google Calendar before responding. Calendar sync now runs after the response, with contained failures. Google requests and token refreshes have a 15-second timeout.
- 66 ordinary server-action submit buttons had no pending feedback. They now share a busy state and disable duplicate clicks, preserving button names, values, classes, and existing disabled conditions. Specialized visit, follow-up, invitation, and PDF flows retain their existing pending behavior. Native navigation and POST forms retain their browser behavior.
- Missing tasks and invalid task assignees silently returned. Worklist forms now show errors, retain entered values, and close dialogs only after a successful save. Successful task mutations show an accessible confirmation without discarding filters.
- Opportunity Snooze silently returned for missing/past dates. Required input and inline server validation now explain the failure. Dismiss and stale-opportunity errors use the same form feedback.
- My Week's assignee validation now matches Worklist and excludes Platform Admin accounts.

## Coverage

| Control family | Review |
| --- | --- |
| Worklist / My Week | Complete, cancel, edit, reschedule, reassign, task creation, visit launch, dialog close, filters, ownership views |
| Field CRM | Visit forms, contextual follow-ups, contacts, tags, account notes, menu placements, account edits and merge, search and pickers |
| Opportunities / agency focus | Follow-up controls, evidence disclosures, snooze, dismiss, status forms |
| Orders | Customer search, PDF review/generation, product rows, checklist buttons; automatic Filed remains explained and disabled |
| Administration / platform | User, invitation, organization, product selection, research, digest, import, calendar and profile form wiring and existing access/availability guards |
| Shared controls | Navigation, search submit, date picker, disclosures, modal close, loading and retry handlers |

Regression tests exercise task completion and tenant-scoped missing-task rejection in both pages, and deferred calendar failure handling. A temporary local browser fixture verified pending/disabled, error/input retention, success confirmation, and named multi-submit behavior at mobile and desktop sizes. The fixture is excluded from the release.
