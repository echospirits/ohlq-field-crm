# Account management

Audit baseline: TST `5faee9df930bd76b5e56b669f58a57210527f7d5`, inspected 2026-10-10.

Shared agency and wholesale directories expose tenant notes, contacts, tags, targeting, relationship stage, Worklist, visits, photos and relevant sales. Wholesale import protection and platform merge authorization are established behavior. Echo staff can browse Retail and Restaurant accounts across states within their role permissions. Sales and inventory coverage depend on the data source. Tenant overlays support account categories, parent groups, geographic territories, teams, typed custom fields and document references; contacts can link the same person across accounts. Existing directory identities remain authoritative. Preserve raw OHLQ identifiers.

## Implementation references

- `app/agencies/[id]/page.tsx`
- `app/wholesale/[id]/page.tsx`
- `lib/accountMemory.ts`

## Validation and remaining work

See [implementation progress](../engineering/implementation-progress.md), [feature inventory](../product/feature-inventory.md), and [test report](../releases/v0.2-test-report.md). Existing behavior above is source-audited; it is not a claim of fresh live verification. Changes must update this document and the inventory.
