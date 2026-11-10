# Production Forecasting - Operational Signals

The initial Operational Signals extension shipped with version 0.6.0. The owner-authorized warehouse comparison is now in **0.8.0-dev, TST first for review**; production remains 0.7.3. The existing statistical model is unchanged. Forecast, immediate agency replenishment, warehouse stock and delivery availability remain independently stored. Nothing adds the operational estimate to a forecast or planning target.

## Sources and meaning

**Immediate demand** uses the authorized OPS Products -> View Item Coverage popup, not Partner DC Demand. Its read-only request is `GET https://ops.ohlq.com/product/itemCoverage/{OrganizationProduct.externalItemCode}`. The existing OPS login/browser infrastructure is reused.

The native JSON contains product `bpc` (bottles per case), `statusCode`, `detailCode`, complete coverage counts and 16-column agency rows. Row indices: agency `[2]` (must agree with `[0]`), coverage group `[6]`, MIN bottles `[7]`, current inventory bottles `[9]`. Validate all coverage counts before accepting a product. Only `MIN` rows count; A3A Bail remains eligible, A3A Dist and delisted products remain excluded.

For each agency, cases to reach MIN are `max(0, ceil((MIN bottles - inventory bottles) / bottles per case))`. Round per agency, then sum by product. Owner-confirmed example: 2806B, agency 30221, MIN14, inventory0, six bottles per case -> three cases. Equality creates no gap. Missing/negative quantities or conflicting duplicates make the product unavailable; identical duplicate rows are deduplicated without doubling demand.

Agency prefixes 2/4 map to GRN; 1/3/5 map to GPT (owner confirmed). Other prefixes remain unassigned. Product summaries include an unassigned amount rather than guessing a warehouse.

### Warehouse inventory and shortfalls

The forecast table/detail display GPT | GRN demand, warehouse inventory and signed balance in cases. Stock comes from A3A Reports → Inventory Management → **DC Inventory**, report `6b07a165-c515-4f63-bef4-471ef64e3e96`, using the existing OPS/Microsoft browser flow. From and To both select the current organization business date, Historical items is explicitly False, and all brands are selected. The importer independently requires the native row's actual `As_of_Date` to match; requested dates and render/retrieval time cannot make an older snapshot current.

Owner-confirmed stock is **GPT Quantity + GPT Picked**, and **GRN Quantity + GRN Picked**. GPTR/GRNR are excluded. Source quantities already represent cases; case pack is evidence rather than a divisor. Up to four source decimal places are preserved. The report supplies a business date but no verified publication clock; `sourceUpdatedAt` stays null.

Balance is **inventory − immediate demand** per warehouse. Positive means excess, negative means shortfall and appears red with an accessible shortfall label. Current balance requires known, complete same-day demand with a current source publication and a valid same-day warehouse snapshot. Missing/stale values remain unavailable, not zero; a valid GPT can remain useful when GRN is unavailable. Unassigned demand is not allocated or used to invent alerts. This does not change statistical forecasts or planning targets.

My Schedule shows all current negative product/warehouse pairs to entitled Echo Admins and Sales (including existing platform-admin semantics), with inventory, demand and signed balance. TASTER/other tenants do not receive the widget. Product links preserve schedule day/week/date through forecast horizon changes. No transfer is made automatically. Missing coverage is disclosed so an empty widget is not mistaken for proof that all warehouses are covered.

The existing morning workflow imports one native DC report independently of demand and delivery completion, retaining immutable daily per-product/warehouse observations and attempt checks. Failed attempts retain prior evidence without making it current. New reads use only compact persisted latest observations; page views never poll providers. Migration `20261110010000_production_warehouse_inventory` is additive. Existing OPS/Microsoft credentials, feature entitlement and sales-product selection are reused unchanged.

For TST-only operator work, `scripts/production-warehouse-inventory.ts` requires explicit env-file, expected-host, expected-target=neon-neat-tst, and reviewed checksum for mutations. Migrate/check/CSV-ingest modes affect only the two new tables; rehearsal constraint forgeries roll back. The scoped TST acceptance workflow refreshes forecasting stock and pending current demand only, shares the existing provider concurrency lock, and discards private exports. See [validation](releases/0.8.0-validation.md) for checksum, target identities and delivery receipts. A code rollback retains the additive tables; do not delete observations.

This is an **overnight agency replenishment estimate**, not an outstanding/allocated purchase order. The owner described same-day shipment and agency scans with an approximately 2 AM inventory load. V1 samples in the morning and clearly discloses same-day timing lag. The retained Bailment report has shipment dates but no receipt/scan status; do not infer unreceived quantities or subtract them a second time. `inboundCases` remains null, not zero.

The verified Products `p.footnote` publishes `Item Coverage as of As of 3 Nov 2026 2:01 AM.` Parse strictly in America/New_York and preserve its provenance separately from retrieval time. Missing, future, conflicting or ambiguous publication times remain unknown. `R14Date` concerns performance data and is never an inventory timestamp. Known stale publication data must not masquerade as a fresh morning success.

The later live acceptance pull published November3 at10:01 PM Eastern. Thus2 AM is the owner's expected refresh timing, not a hard-coded source guarantee. Display the actual **coverage source as-of** timestamp and retrieval time independently; do not claim that the footnote proves individual agency receipt scans.

**Delivery availability** uses the supported [OpenDock Neutron API](https://developer.loadsmart.com/docs/opendock/for-carriers/booking-appointments). Login exchanges the authorized account for a short-lived in-memory JWT. Read-only load-type discovery precedes `POST /loadtype/{id}/get-availability`; this computes slots and never books an appointment. Requests have bounded timeouts/retries and a bounded 90-day search. No visible slots means no slots within the checked range, not permanent warehouse unavailability.

Verified facility identities:

| OHLQ | OpenDock warehouse ID | Facility |
| --- | --- | --- |
| GPT | `c45c3cbf-7b28-4c82-8255-260f2fec7c45` | DHL Supply Chain Ohio Liquor, DSC - Retail, 3755 Hayes Road, Groveport OH43125 |
| GRN | `db3517ad-e875-499b-883d-14ff21859355` | DHL Supply Chain Ohio Liquor, DSC - Retail, 2210 International Pkwy, Green OH44320 |

The owner confirmed **LTL - Pallet Load** for both. Load-type UUIDs are discovered using the authorized API, never guessed. The setup action enforces each facility identity server-side and rejects missing/duplicate LTL matches. Both facilities use America/New_York. The user-visible calendar was verified read-only; no appointment was submitted.

## Schedule, history and baseline

Extend the existing `sync:production-sources` morning process. TST selects 7:27 AM Eastern using the existing DST-aware GitHub Actions slots. OpenDock locations and OPS products fail independently. A successful daily observation skips redundant polling; failed checks can retry. Vercel's existing forecast cron still refreshes statistical snapshots rather than making dashboard requests to upstream portals.

Successful daily observations are immutable. Separate check rows record attempts and safe diagnostic codes. A failure never deletes/replaces a successful observation. Preserve the raw appointment timestamp/date and observation time. Changed warehouse/load-type mappings do not reuse incompatible historical comparisons.

Calendar-date distance in the warehouse timezone is primary. Business days are available only with an explicit verified operating calendar covering the entire interval; dates with no bookable slots cannot establish closures. The default setup does not invent a holiday calendar.

Baseline stages require at least 14 distinct prior observation days: prior-year seasonal +/-30 calendar days, nearby calendar period, then trailing90 days; otherwise insufficient history. Today's/future observations never define their own baseline. The comparison tolerance is the larger of one day or 20% of typical. Comparisons are descriptive history, not delivery predictions. No-availability ranges do not become zero-day observations.

## Configuration and security

1. Apply only `20261104010000_production_operational_signals` after verifying the TST target and rehearsal. Do not blindly apply unrelated migration-ledger gaps.
2. Current TST uses the existing `OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY`, verified by live credential save/decryption/API capture. The owner explicitly chose to keep it. Do not rotate that key or substitute a new value; it protects existing OPS credentials. Sensitive values are omitted from local environment exports; their absence there does not establish missing hosted configuration. Optional dedicated `PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY` is supported for initial setup (at least32 characters, same value in TST application and GitHub `test` environment). **Do not enable it for this already-saved connection without a coordinated credential migration:** current v1 ciphertext uses the previously selected key and has no key identifier. Compatible key identification and server-side re-encryption must precede a future switch. A malformed dedicated key fails closed. Verify new morning ingestion acceptance separately from successful administrator capture.
3. Existing encrypted OHLQ credentials, active Ohio enrollment and `PRODUCTION_FORECASTING` entitlement are required. Existing current Organization product mappings determine item codes; no Echo item codes are hard-coded.
4. An authorized Echo administrator opens `/analytics/production/settings`, enters OpenDock credentials and selects Save and verify. API discovery must succeed before credentials and mappings commit together. Failure preserves the previous pair. Then select **Check delivery availability** to capture the first daily observations without running OPS imports or forecasts. The bounded server action checks warehouses independently, reuses today's successful observations and permits failed checks to retry. Raw passwords are never returned to the browser. Encryption authenticates organization, provider and field to prevent ciphertext swapping.
5. MFA/SSO/CAPTCHA or unavailable API permission is a source gate requiring provider-supported access. Do not bypass it or substitute fragile scraping. Verify both API next-available values against the source before claiming live readiness.

The five additive tables are `OrganizationOperationalCredential`, `DeliveryAvailabilityObservation`, `DeliveryAvailabilityCheck`, `CurrentDemandObservation` and `CurrentDemandCheck`. Compound tenant/product references and daily uniqueness protect history. The large per-agency evidence is separate from compact dashboard summaries. All reads, writes, jobs and configuration retain the existing Echo-only pilot boundary.

No ERP integration, another state, logistics optimizer, predictive delivery model, production deployment or release tag is included. Generic observation concepts allow future adapters without changing forecast inputs.

## Validation and staging readiness

Live OpenDock acceptance passed November4,2026 at05:27 AM Eastern: GPT November10 at06:00 AM EST (6 calendar days), GRN November6 at06:00 AM EST (2 calendar days). Both agree with the native LTL booking calendars. A repeated administrator check reused the saved daily observations; both history tables contain one fact. No appointment was booked. Current baselines correctly report insufficient history. The new scheduled morning run is still an independent acceptance gate.

See [the resumable checkpoint](../production-operational-signals-checkpoint.md) for actual checks, migration receipts, source proof, limitations and delivery state.
