# Supplies

Supplies is a simple ordering and delivery status dashboard for materials flagged by **Dx5** low-inventory alerts or confirmed **Production replenishment orders**. Dx5, and later Ollie, own inventory levels, forecasting and lead times. Neat answers whether an order has been found and what is happening with its delivery.

The owner narrowed the earlier coordination workspace and approved production release **0.10.0**, then separately approved Echo production activation on November 12, 2026. The selective **0.10.1** reliability hotfix adds confirmed-order cards, corrects material/image/attachment matching and uses the existing durable runtime for the 15-minute cadence. See [current validation](releases/0.10.1-validation.md) and [historical production activation](releases/production-supplies-production-activation.md) for exact receipts. Production connections and each owner's consent remain separate from TST; historical backfill is still progressing.

## Daily use

Open **Production → Supplies** at `/production-supplies`.

- One card shows each watched material/location in its current replenishment cycle, identifying its Dx5 alert or confirmed Production-order source.
- Cards show the latest reliably matched order/delivery status, supplier and available sourced arrival. Missing evidence is unknown; “No order found” does not claim nobody placed an order.
- Prepayment holds, planned payment dates and generic supplier promised dates remain separate from shipment/arrival evidence. A plan to pay is not a payment or dispatch confirmation.
- Repeated Dx5 alerts caused by further usage update the same cycle. They do not create additional cards.
- The original verified Dx5 label keeps that identity stable even if extraction varies its name or splits a parenthetical fragment into an assumed ID. Reviewed catalog identities and genuine ID/location conflicts remain authoritative.
- **Dismiss** hides the current cycle. Later repeated alerts in that cycle do not bring it back.
- A completed relevant replenishment delivery removes the card. A genuinely later low-stock alert can start a fresh cycle. Old reprocessed messages cannot reopen it.
- Partial, returned, cancelled, conflicting or unallocated shipments do not falsely prove complete delivery. Their card remains visible with the uncertainty; Dismiss is available when the team does not want to track it.

There are no tabs, history, search filters, manual orders/needs, catalog controls or record editors in this dashboard. Existing order-detail and catalog URLs return to Supplies. Existing domain records, raw external identifiers, source links and audit evidence are retained; removing a card does not delete them.

Dismissal requires the existing management permission. Viewers retain read-only cards. Hiding a card never creates an internal receipt, resolves authoritative inventory, purchases anything, messages suppliers, or writes accounting/inventory entries.

## Material scope and matching

Recognized Dx5 alerts and authenticated confirmed Production replenishment purchases seed the watch list. Separate current buyer requests and supplier acknowledgements can establish one purchase; an identifying proforma can enrich it. A quote/proforma alone, supplier identity alone, consumer purchase or unrelated manually retained need cannot independently create a card. Server-side active team membership, authorized mailbox ownership and current source identity enforce this boundary. The normalized warning interface leaves room for a future Ollie adapter; Ollie is not connected today.

Automatic matching uses tenant-scoped catalog identity, explicit reviewed supplier/SKU aliases or a unique conservative full-material match. A supplier name or partial description is insufficient. An unknown inventory-warning location does not invalidate an exact non-shared material order. Known destination conflicts and shared-purpose ambiguity still prevent confident association; completed-delivery hiding retains strict physical/quantity/time proof. Raw Dx5 material IDs, vendor SKUs and original units remain separate and must not be guessed, converted or rewritten.

Relevant mailbox discovery continues so new alerts and order updates can be found. Validated unmatched facts can be retained for bounded reconciliation when an older warning is discovered during a newest-first backfill. Unrelated purchases do not create operational orders or carrier registrations. Existing unrelated historical records remain stored and stay off the dashboard.

Only current authored text and independently meaningful attachments establish new facts. Quoted history, logos and signature images cannot repeat an old order. Reprocessing legacy automatic evidence can quarantine unsupported purchases with an audit while retaining original records, independent current/manual evidence and explicit manual ignores.

Attachment evidence uses stable message/MIME identity so changing download handles cannot restart its extraction on every resume. Original external keys remain preserved. Legacy documents are reused only through a unique message-bound identity; ambiguous same-name attachments stay separate for review.

## Connections and background updates

Connection administration remains separate at `/production-supplies/settings`, also linked from Users. Existing organization teams identify Production membership independently of role, view/manage permission and mailbox consent. Each person connects their own verified business Gmail using read-only consent; Support View never grants private mailbox access.

Production uses the three verified existing Joe, Karl and Nikhil accounts, with Production membership and view/manage grants independent of their unchanged roles. Joe's own read-only production Gmail consent is connected. Karl and Nikhil must each sign in and choose **Connect my Gmail** in settings; their mailboxes remain excluded until then. No duplicate accounts or email addresses are invented. TST's earlier Joe connection is separate. Historical backfill remains bounded and checkpointed; initial live processing does not establish full 90-day completion.

Gmail OAuth uses dedicated `SUPPLY_GOOGLE_CLIENT_ID` / `SUPPLY_GOOGLE_CLIENT_SECRET`, the stable `SUPPLY_MAIL_TOKEN_ENCRYPTION_KEY`, `SUPPLY_MAIL_INGESTION_ENABLED=true`, and matching `SUPPLY_MAIL_OAUTH_ENVIRONMENT`/`APP_ENV`. TST's supply-only callback is `https://neat-tst.vercel.app/api/production-supplies/mail/google/callback`; production's is `https://crm.echospirits.com/api/production-supplies/mail/google/callback`, set via `SUPPLY_GOOGLE_REDIRECT_URI`. Each environment needs its own client, keys, owner consent and schedule secret. Calendar configuration is independent; never transfer TST tokens into production.

The supply-only worker runs without an open dashboard. An existing durable Workflow loop owns the 15-minute schedule, with persisted tenant ownership, work leases, deployment fencing and bounded catch-up. GitHub Actions' independently gated TST/production triggers and Vercel's daily cron ensure or recover that loop; they do not run a second provider batch. GitHub uses each environment's existing secret and repository variable `PRODUCTION_SUPPLIES_SCHEDULE_ENABLED=true`. New Dx5 alerts, Production requests and watched material/reference updates have fair discovery lanes while historical and incremental checkpoints continue independently. Retained signature-image sources are corrected without downloading or extracting them again. Connection/error/import state qualifies displayed evidence. The page refreshes while visible. [Hotfix validation](releases/0.10.1-validation.md) distinguishes local scheduling tests from observed hosted sleep/resume; a manual success alone is not proof of recurring execution.

## Delivery sources and limits

Supplier promises, carrier estimates, manual expectations and actual delivery remain distinct. Date-only arrival information retains its calendar precision. Old observations cannot replace newer facts, and outages retain the last valid result.

The implemented EasyPost adapter supports standalone parcel tracking behind separately approved credentials/fees. Continuous carrier API tracking remains disabled until those are supplied. The verified one-time public UPS lookup returned Label Created with no ETA; it is not continuous API verification. GFS supplier delivery and freight require additional permitted integrations. See [tracking setup](production-supplies-tracking.md).

## Data and recovery

This simplification requires no new migration. Existing normalized tables retain warnings, orders, shipments, source facts and audit. Dismissal is recorded against the current cycle in the existing tenant-scoped audit store; inventory and receipt state stay independent.

The original additive migration is `20261112010000_production_supplies`. The maintained setup script requires an explicit verified nonproduction target and reviewed checksum. Production release applies only that reviewed SQL after its production-derived rehearsal and fingerprint comparison; do not replay unrelated migration history or delete tables. Disable the entitlement or supply-only switches to stop future processing while retaining evidence.

See [validation](releases/production-supplies-validation.md) for exact tests, deployments, live evidence and remaining provider gates. Earlier broad-workspace validation is historical and does not describe the current dashboard UI.
