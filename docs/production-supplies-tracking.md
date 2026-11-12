# Production Supplies tracking operations

The November 12 owner revision limits operational tracking to **Dx5-alerted materials**. Known alerted materials remain eligible for later order/delivery evidence even after dismissal, so a fresh post-delivery alert can start another cycle. Unrelated purchases do not register trackers. The dashboard has no manual tracking editor, refresh button, receipt confirmation or history flow; only Dismiss. Retained domain records and provider observations are preserved.

Production Supplies uses a small EasyPost adapter for standalone **parcel** tracking. It creates a tracker from a supplier's tracking number, reads its stored carrier observations, and accepts authenticated updates. It never buys a shipping label. EasyPost supports tracking labels purchased elsewhere and maintains those trackers in the background. Some carriers require additional carrier credentials; account access must be verified against a real authorized shipment. [Official tracker reference](https://docs.easypost.com/docs/trackers).

## Selection and live-verification limits

The initial app-connection audit found no Neat mailbox connections. A subsequent authorized one-time inspection through Joe's existing business Gmail connector found UPS parcels, GFS supplier delivery and unconfirmed freight arrangements. That actual mix grounds the supported UPS parcel path while preserving the supplier/freight gaps. A one-time public official UPS check returned Label Created with no ETA; the billed date and service level did not become an arrival estimate. This is a manual source observation, not EasyPost or continuous API acceptance. Adapter tests use sanitized fixtures and injected responses; no live EasyPost key, registration or webhook is claimed.

The adapter explicitly accepts UPS, USPS, FedEx, DHLExpress, OnTrac, CanadaPost and RoyalMail parcel references. These strings appear in EasyPost's documented carrier list. Other carriers produce an actionable unsupported-carrier message and retain existing arrival evidence. Freight PRO, bill of lading and supplier order identifiers are stored as distinct types; this parcel adapter never submits them as tracking numbers. [Carrier strings and standalone-access restrictions](https://docs.easypost.com/docs/trackers).

Alternatives reviewed:

- AfterShip provides broader freight-specific adapters, including Old Dominion, but its published Old Dominion integration requires an active carrier account. API and webhook access starts with Tracking Premium. Its current public calculator starts Premium at $59/month on the displayed annual allowance; obtain an account-specific quote before choosing a plan. No subscription was purchased. [API-plan eligibility](https://support.aftership.com/en/tracking/articles/15703637-which-aftership-tracking-plans-include-api-access-for-shipment-tracking), [pricing](https://www.aftership.com/pricing/tracking), [Old Dominion requirements](https://www.aftership.com/integrations/carriers/old-dominion).
- Direct freight APIs are possible once actual carriers are known. For example, TForce publishes a dedicated PRO tracking API. No TForce shipment or authorized account was available here. [Official TForce manual](https://www.tforcefreight.com/downloads/Tracking-API-User-Manual-V1.pdf).
- Gordon Food Service advertises real-time truck ETAs through Gordon Now using the customer's Gordon Ordering login. A public customer delivery-status API or documented permission for a tracking-page adapter was not established. Neat therefore retains supplier promises and manual expectations and shows this limitation. A Gordon account plus a supported GFS integration agreement/API is needed before implementing unattended delivery lookups. `gfsdeliver.com` is a different shipping-platform provider and must not be mistaken for Gordon Food Service. [Gordon Now](https://gfs.com/en-us/products-services/technology-solutions/gordon-now-app/).

## Server configuration

Set these only in the intended environment, with credentials kept server-side:

| Variable | Purpose |
| --- | --- |
| `SUPPLY_TRACKING_MODE` | `disabled` (default), `test`, or `live` |
| `EASYPOST_TEST_API_KEY` | Test-mode key, used only in `test` mode |
| `EASYPOST_LIVE_API_KEY` | Production-mode key, used only in `live` mode |
| `SUPPLY_TRACKING_LIVE_ENABLED` | Must explicitly be `true` before paid live tracker registration is allowed |
| `EASYPOST_WEBHOOK_SECRET` | Shared HMAC secret configured on the EasyPost webhook |
| `SUPPLY_TRACKING_ACTIVE_MINUTES` | Active reconciliation interval, default 240; allowed 15–1440 |
| `SUPPLY_TRACKING_DUE_MINUTES` | Due-soon/out-for-delivery reconciliation interval, default 60; allowed 15–1440 |

EasyPost currently lists basic Tracking API fees of $0.01–$0.03 per shipment. Confirm account pricing and charges with the account owner before enabling live registration. No new account, paid plan, subscription or tracker was created during implementation. [Official pricing](https://www.easypost.com/pricing/).

Enable the tenant's `PRODUCTION_SUPPLIES` entitlement separately. The scheduled Production Supplies job must run with the existing cron authentication and environment guards. It selects the oldest due shipment and mailbox work across entitled active tenants even when no dashboard is open. Each run starts a bounded tracking lane and up to two mailbox lanes concurrently. Long imports checkpoint their current page and message; they do not block tracking or the next person's turn. New references are due immediately; manual refresh is limited to once per five minutes. Worker leases prevent concurrent duplicate registrations; stored tracker IDs are reused. Repeated identical standalone registration is also deduplicated by EasyPost within its documented three-month window. [Tracking guide](https://docs.easypost.com/guides/tracking-guide).

## Authenticated updates and safe requests

Configure `https://<this-environment-host>/api/production-supplies/tracking/webhook` in the matching EasyPost account mode after deploying the route. The application verifies HMAC v2 using `x-timestamp`, `x-path`, `x-hmac-signature-v2` and the exact raw body. Requests older than one minute or over 30 seconds in the future are rejected. Only stored provider-tracker mappings select tenants; payload-supplied organization identifiers are ignored. Test events cannot change a live-mode registration. [Official HMAC specification](https://support.easypost.com/hc/en-us/articles/39826034964237-Webhook-HMAC-Validation).

All outbound tracking traffic uses the fixed `https://api.easypost.com/v2` origin, bounded timeouts/retries and rejected redirects. Links in emails and arbitrary tracking-page URLs are never fetched. Provider authorization failures explain the missing account/carrier access without storing response bodies or secrets.

## Arrival, outages and receipt

Carrier estimates are normalized separately from supplier promises, appointments, predictions and manual expectations. Calendar dates remain strings; date-only estimates never acquire an invented time. Each change preserves prior estimates and the source observation time. Old provider events are retained as history without regressing newer facts; later legitimate corrections can change the status in either direction.

Temporary failures retain the last valid estimate and expose a check error, freshness and scheduled retry. Delivered parcels reduce reconciliation to daily; cancelled/returned parcels stop polling but authenticated provider corrections remain eligible. A delivery after return-to-sender remains a return, preventing a scan at the sender from becoming delivery to the facility. Internal receipt, shortages/damage, and operational need resolution remain explicit separate actions. EasyPost's own FAQ confirms a returned parcel can later have a delivered scan at the return destination. [Tracker behavior and returns](https://support.easypost.com/hc/en-us/articles/360044353091-Understanding-Trackers).

## Remaining activation steps

1. Joe's approved replacement Google client and own read-only Gmail connection are active in TST. Karl/Nikhil have no matching existing TST accounts, including checks against addresses observed in a business thread; they need actual accounts and their own consent. Do not create accounts without separate authorization.
2. Let the bounded autonomous historical import continue from its durable checkpoint. Initial live source extraction passes; the full historical scan is not complete. A separate one-time authorized connector snapshot already populated operational candidates.
3. Supply an approved environment-specific EasyPost key and any required carrier credentials, confirm costs, then enable the matching mode.
4. Configure the authenticated tracking webhook, then verify the real provider path through stored carrier observations to the dashboard. The supply background schedule is already activated and its GitHub-to-TST worker invocation verified. No ETA should be invented when the carrier provides none.
5. Verify outage preservation, provider correction, partial/returned delivery and cycle closure in the intended environment. A complete relevant delivery hides the status card without an internal receipt or inventory transaction. Document unsupported carriers and obtain supplier/carrier integration access where needed.
