# Integration architecture

Production Supplies (0.10.0 release) is a simple status dashboard scoped to Dx5-alerted materials. Its dedicated feature-scoped Gmail runtime is independent of Calendar and retired Communications; Joe's own read-only connection and initial live extraction are verified in TST. Production activation requires its own configuration and owner consent. Source metadata/evidence, warning cycles, dismissal audit and operational records remain tenant-scoped; unrelated mailbox contents are not exposed. EasyPost parcel polling/webhook persistence is limited to watched-material orders and remains disabled pending approved credentials/fees. Completed relevant delivery hides a card without receipt or inventory writes; partial/returned/ambiguous delivery stays visible. Freight/supplier deliveries retain explicit automation limits. See [guide](../production-supplies.md) and [tracking evaluation](../production-supplies-tracking.md).

October 28 Echo-only TST transition: background consumers restrict processing to Echo without deleting stored outside connections or transferring ownership. OHLQ credential use, inventory/discovery and forecast sources reject foreign targets; calendar execution rechecks current Echo membership; mail/SMS consumers require Echo in addition to existing provider/pilot gates. No live provider activation, disconnection, message send or import was performed for this change. See [background jobs](background-jobs.md) and [transition validation](../releases/echo-only-transition-validation.md).

Audit baseline: TST `5faee9df930bd76b5e56b669f58a57210527f7d5`, inspected 2026-10-10.

Existing Google Calendar connects a user to Worklist events; this is not Gmail ingestion. Ohio integrations import shared directories and supplier-specific sales/inventory. Mailbox integrations use separately authorized Google/Microsoft connections, normalized changes, private visibility by default and persisted cursors. SMS, Eventbrite, Google Routes and reviewed AI now have replaceable adapters with mock/fallback acceptance. Never describe adapters or fixture tests as live provider verification.

## Implementation references

- `lib/calendar`
- `lib/marketDataProvider.ts`
- `lib/ohlqAnnualSalesWorkflow.ts`

## Validation and remaining work

See [implementation progress](../engineering/implementation-progress.md), [feature inventory](../product/feature-inventory.md), and [test report](../releases/v0.2-test-report.md). Existing behavior above is source-audited; it is not a claim of fresh live verification. Changes must update this document and the inventory.

## Communications retired in 0.4.0

The earlier integration audit above is historical. Mailbox OAuth/adapters/metadata ingestion/imported appointments, business SMS adapters/callbacks, contact suggestions and reviewed communication AI have been removed, including UI, actions and cron endpoints. No configuration or old entitlement row restores them. Schema and historical records remain compatible; ordinary contacts/manual interaction capture and independent Worklist calendar sync remain.

Current retained CRM provider implementations include `lib/crm/eventbrite.ts` and `lib/crm/routeProvider.ts`. Live provider setup remains separate from fixture verification. [Retirement evidence](../releases/communications-retirement-validation.md).
