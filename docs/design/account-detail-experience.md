# Account detail experience

Audit baseline: TST `5faee9df930bd76b5e56b669f58a57210527f7d5`, inspected 2026-10-10.

The implementation descriptions below are historical. Use the revised [UI/UX Guidelines](../UI-UX-GUIDELINES.md) for design decisions: expose important saved account facts in a compact read view, separate editing from reading, and preserve workflow behavior while allowing presentation changes. Current release scope controls feature availability; retired Communications and Recipes references are not directions to restore those features.

The account is the primary workspace. Preserve notes/contacts then outstanding Worklist, account context and return links. Add communication logging and timeline filtering close to relationship information. Private correspondence must not leak through counts, headings or summaries.

## Implementation references

- `app/components/AccountWorkspaceNavigation.tsx`
- `app/components/AccountWorklist.tsx`
- `app/agencies/[id]/page.tsx`
- `app/wholesale/[id]/page.tsx`

## Validation and remaining work

See [implementation progress](../engineering/implementation-progress.md), [feature inventory](../product/feature-inventory.md), and [test report](../releases/v0.2-test-report.md). Existing behavior above is source-audited; it is not a claim of fresh live verification. Changes must update this document and the inventory.

## Current implementation

Existing notes, Contacts and outstanding Worklist retain their order and context. Account profile/territory/team/documents are disclosed in an expandable section. Account plans extend the sales status panel. Playbooks sit within Worklist; SMS sits with Contacts. Recipe recommendations use the existing wholesale account context.

The existing activity component projects communication, physical visits, completed work, status/order history and events, with filters over loaded authorized records. The briefing separates meaningful contact, physical visits, completed follow-ups and purchase evidence, then offers optional reviewed assistance. Log Visit is the only interaction-entry route. Existing account tabs and workspace navigation remain intact rather than being replaced by another workspace.
