# Supplies

Supplies is a simple ordering and delivery status dashboard for materials flagged by **Dx5** low-inventory alerts. Dx5, and later Ollie, own inventory levels, forecasting, lead times and the decision that a material is needed. Neat answers whether an order has been found and what is happening with its delivery.

The owner narrowed the earlier coordination workspace and approved production release **0.10.0** on November 12, 2026. See [production release validation](releases/0.10.0-validation.md) for deployment and activation receipts. Earlier TST evidence remains historical; production connections and consent are separate.

## Daily use

Open **Production → Supplies** at `/production-supplies`.

- One card shows each alerted material/location in its current replenishment cycle.
- Cards show the latest reliably matched order/delivery status, supplier and available sourced arrival. Missing evidence is unknown; “No order found” does not claim nobody placed an order.
- Repeated Dx5 alerts caused by further usage update the same cycle. They do not create additional cards.
- **Dismiss** hides the current cycle. Later repeated alerts in that cycle do not bring it back.
- A completed relevant replenishment delivery removes the card. A genuinely later low-stock alert can start a fresh cycle. Old reprocessed messages cannot reopen it.
- Partial, returned, cancelled, conflicting or unallocated shipments do not falsely prove complete delivery. Their card remains visible with the uncertainty; Dismiss is available when the team does not want to track it.

There are no tabs, history, search filters, manual orders/needs, catalog controls or record editors in this dashboard. Existing order-detail and catalog URLs return to Supplies. Existing domain records, raw external identifiers, source links and audit evidence are retained; removing a card does not delete them.

Dismissal requires the existing management permission. Viewers retain read-only cards. Hiding a card never creates an internal receipt, resolves authoritative inventory, purchases anything, messages suppliers, or writes accounting/inventory entries.

## Material scope and matching

Only recognized Dx5 alert materials seed the watch list. Other emails or manually retained needs cannot independently create cards. The normalized warning interface leaves room for a future Ollie adapter; Ollie is not connected today.

Automatic matching uses tenant-scoped catalog identity, explicit reviewed supplier/SKU aliases or a unique conservative full-material match. A supplier name or partial description is insufficient. Destination conflicts, shared-purpose ambiguity and unknown shipment contents remain uncertain. Raw Dx5 material IDs and vendor SKUs are separate fields and must not be guessed or rewritten.

Relevant mailbox discovery continues so new alerts and order updates can be found. Validated unmatched facts can be retained for bounded reconciliation when an older warning is discovered during a newest-first backfill. Unrelated purchases do not create operational orders or carrier registrations. Existing unrelated historical records remain stored and stay off the dashboard.

## Connections and background updates

Connection administration remains separate at `/production-supplies/settings`, also linked from Users. Existing organization teams identify Production membership independently of role, view/manage permission and mailbox consent. Each person connects their own verified business Gmail using read-only consent; Support View never grants private mailbox access.

Joe's Production membership and own read-only Gmail connection are active in Echo TST. Karl/Nikhil need actual Neat accounts and their own consent. No duplicate accounts or email addresses are invented. The historical backfill remains bounded and checkpointed; initial live processing is verified, not full 90-day completion.

Gmail OAuth uses dedicated `SUPPLY_GOOGLE_CLIENT_ID` / `SUPPLY_GOOGLE_CLIENT_SECRET`, the stable `SUPPLY_MAIL_TOKEN_ENCRYPTION_KEY`, `SUPPLY_MAIL_INGESTION_ENABLED=true`, and matching `SUPPLY_MAIL_OAUTH_ENVIRONMENT`/`APP_ENV`. TST's supply-only callback is `https://neat-tst.vercel.app/api/production-supplies/mail/google/callback`; production's is `https://crm.echospirits.com/api/production-supplies/mail/google/callback`, set via `SUPPLY_GOOGLE_REDIRECT_URI`. Each environment needs its own client, keys, owner consent and schedule secret. Calendar configuration is independent; never transfer TST tokens into production.

The supply-only worker runs without an open dashboard. GitHub Actions defines independently gated TST and production triggers every 15 minutes, each with its own environment secret and `PRODUCTION_SUPPLIES_SCHEDULE_ENABLED=true`; Vercel Hobby also has a daily fallback. Production is disabled until its activation gate is completed. Scheduled cadence can be delayed; connection/error/import state qualifies the displayed order evidence. The page refreshes while visible.

## Delivery sources and limits

Supplier promises, carrier estimates, manual expectations and actual delivery remain distinct. Date-only arrival information retains its calendar precision. Old observations cannot replace newer facts, and outages retain the last valid result.

The implemented EasyPost adapter supports standalone parcel tracking behind separately approved credentials/fees. Continuous carrier API tracking remains disabled until those are supplied. The verified one-time public UPS lookup returned Label Created with no ETA; it is not continuous API verification. GFS supplier delivery and freight require additional permitted integrations. See [tracking setup](production-supplies-tracking.md).

## Data and recovery

This simplification requires no new migration. Existing normalized tables retain warnings, orders, shipments, source facts and audit. Dismissal is recorded against the current cycle in the existing tenant-scoped audit store; inventory and receipt state stay independent.

The original additive migration is `20261112010000_production_supplies`. The maintained setup script requires an explicit verified nonproduction target and reviewed checksum. Production release applies only that reviewed SQL after its production-derived rehearsal and fingerprint comparison; do not replay unrelated migration history or delete tables. Disable the entitlement or supply-only switches to stop future processing while retaining evidence.

See [validation](releases/production-supplies-validation.md) for exact tests, deployments, live evidence and remaining provider gates. Earlier broad-workspace validation is historical and does not describe the current dashboard UI.
