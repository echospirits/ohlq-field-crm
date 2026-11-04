# Design system

Audit baseline: TST `5faee9df930bd76b5e56b669f58a57210527f7d5`, inspected 2026-10-10.

The canonical standard is [UI/UX Guidelines](../UI-UX-GUIDELINES.md), revised November 4, 2026. Its Echo-informed visual direction, visible working facts and table/list browsing standards supersede historical presentation descriptions here. Reuse tested behavior and semantic primitives such as PageHeader, SectionHeading and EmptyState; improve their shared presentation rather than preserving existing cards, colors or spacing by default. Do not add a competing component framework. The [guideline audit](ui-ux-guidelines-audit-2026-11-04.md) records the rationale for this direction.

The implemented 0.7.0-dev TST system is documented in [DESIGN.md](../../DESIGN.md) and its `.impeccable/design.json` sidecar, with current [application audit](neat-tst-ui-audit-2026-11-04.md) and [validation](../releases/0.7.0-validation.md). Human review and production release approval remain pending.

## Implementation references

- `app/components/PageChrome.tsx`
- `app/styles.css`
- `docs/UI-UX-GUIDELINES.md`

## Validation and remaining work

See [implementation progress](../engineering/implementation-progress.md), [feature inventory](../product/feature-inventory.md), and [test report](../releases/v0.2-test-report.md). Existing behavior above is source-audited; it is not a claim of fresh live verification. Changes must update this document and the inventory.
