# Supplies

Supplies is a simple ordering and delivery status dashboard for materials flagged by **Dx5** low-inventory alerts or confirmed **Production replenishment orders**. Dx5, and later Ollie, own inventory levels, forecasting and lead times. Neat answers whether an order has been found and what is happening with its delivery.

Production Supplies was activated for Echo on November 12, 2026. The [historical activation record](releases/production-supplies-production-activation.md) and [0.10.1 validation](releases/0.10.1-validation.md) document the original rollout. The [freight and email hotfix](releases/0.15.17.md) updates the current behavior. Production connections and each owner's consent remain separate from TST.

## Daily use

Open **Production → Supplies** at `/production-supplies`.

- One card shows each watched material/location in its current replenishment cycle, identifying its Dx5 alert or confirmed Production-order source.
- Cards show the latest reliably matched order/delivery status, supplier and available sourced arrival. Missing evidence is unknown; “No order found” does not claim nobody placed an order.
- Prepayment holds, planned payment dates and generic supplier promised dates remain separate from shipment/arrival evidence. A plan to pay is not a payment or dispatch confirmation.
- **Bill of lading received** means the document identifies a freight shipment and carrier pickup is still unconfirmed.
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

Production uses the three existing Joe, Karl and Nikhil accounts, with Production membership and view/manage grants independent of their roles. Each connected mailbox has its own read-only consent. The current state appears in **Mailbox status**. Historical backfill remains bounded and checkpointed, and TST uses separate consent.

Gmail OAuth uses dedicated `SUPPLY_GOOGLE_CLIENT_ID` / `SUPPLY_GOOGLE_CLIENT_SECRET`, the stable `SUPPLY_MAIL_TOKEN_ENCRYPTION_KEY`, `SUPPLY_MAIL_INGESTION_ENABLED=true`, and matching `SUPPLY_MAIL_OAUTH_ENVIRONMENT`/`APP_ENV`. TST's supply-only callback is `https://neat-tst.vercel.app/api/production-supplies/mail/google/callback`; production's is `https://crm.echospirits.com/api/production-supplies/mail/google/callback`, set via `SUPPLY_GOOGLE_REDIRECT_URI`. Each environment needs its own client, keys, owner consent and schedule secret. Calendar configuration is independent; never transfer TST tokens into production.

The supply-only worker runs without an open dashboard. Production Vercel cron invokes the authenticated route every 15 minutes to check recent watched replies and freight notices. GitHub Actions retains a six-hour backstop. The route claims the current slot in the database so overlapping invocations cannot repeat the same provider work. Broad mailbox discovery, historical backfill and evidence replay keep their six-hour budget. TST automatic processing remains paused.

Each eligible mailbox checks recent replies on watched orders before resuming catch-up. Supplies warns when the oldest completed mailbox check falls behind its polling window and points to Mailbox status. An unfinished recent check keeps its previous freshness timestamp. The page refreshes while visible.

When a supplier reply reaches another connected mailbox, verified sender and stable email references can associate it with a uniquely identified order. Explicit confirmation of payment clears a payment hold. Shipment and arrival still require their own evidence, and a promise to send a bill of lading leaves shipment pending.

## Delivery sources and limits

Supplier promises, carrier estimates, manual expectations and actual delivery remain distinct. Date-only arrival information retains its calendar precision. Old observations cannot replace newer facts, and outages retain the last valid result.

The EasyPost adapter supports standalone parcel tracking with separately approved credentials and fees. The Ward adapter supports authenticated freight tracking for its configured tenant. Carrier lookups require the matching credentials and configuration. Confirmed delivery can close a specifically reviewed freight replenishment while preserving an unknown stock-alert location. See [tracking setup](production-supplies-tracking.md).

## Data and recovery

This simplification requires no new migration. Existing normalized tables retain warnings, orders, shipments, source facts and audit. Dismissal is recorded against the current cycle in the existing tenant-scoped audit store; inventory and receipt state stay independent.

The original additive migration is `20261112010000_production_supplies`. The maintained setup script requires an explicit verified nonproduction target and reviewed checksum. Production release applies only that reviewed SQL after its production-derived rehearsal and fingerprint comparison; do not replay unrelated migration history or delete tables. Disable the entitlement or supply-only switches to stop future processing while retaining evidence.

See [validation](releases/production-supplies-validation.md) for exact tests, deployments, live evidence and remaining provider gates. Earlier broad-workspace validation is historical and does not describe the current dashboard UI.
