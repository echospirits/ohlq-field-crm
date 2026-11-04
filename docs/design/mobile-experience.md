# Mobile experience

Audit baseline: TST `5faee9df930bd76b5e56b669f58a57210527f7d5`, inspected 2026-10-10.

Verify at 390 x 844 and desktop 1440 x 900. Follow the revised [UI/UX Guidelines](../UI-UX-GUIDELINES.md): retain decisive facts in compact rows or prioritized tables, use live searchable record pickers, and disclose supporting depth deliberately. Cards are a task-specific option. Preserve text after errors or connectivity failure. Forms need pending, success, error and unavailable states. Avoid horizontal document scrolling. This historical audit does not prescribe retaining the incumbent appearance.

## Implementation references

- `docs/UI-UX-GUIDELINES.md`
- `app/components/LiveFilterForm.tsx`

## Validation and remaining work

See [implementation progress](../engineering/implementation-progress.md), [feature inventory](../product/feature-inventory.md), and [test report](../releases/v0.2-test-report.md). Existing behavior above is source-audited; it is not a claim of fresh live verification. Changes must update this document and the inventory.
