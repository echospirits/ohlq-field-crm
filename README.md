# Echo Field CRM MVP

Internal web-based CRM for liquor agency and bar/restaurant field work.

## MVP included
- Account pages for liquor agencies and future bars/restaurants
- Store tags: Cut, Fix, Add, Outperform, Watchlist, Menu Target, Display Opportunity
- Sales/inventory database model for OHLQ files
- Alert/worklist model for lapsed buyers and follow-ups
- Visit/photo model for shelf, display, menu, back bar, competitor evidence
- EventShift model for tour guide scheduling and future Eventbrite sync
- Recipe database for cocktail suggestions
- Weekly digest emails for rep activity, completed work, and upcoming follow-ups

## Setup
1. Create a Postgres database, ideally Neon/Supabase/Vercel Postgres.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Run:
```bash
npm install
npm run db:push
npm run import:sample
npm run dev
```

## Deploy to Vercel
- Push this folder to GitHub.
- Import the repo into Vercel.
- Add `DATABASE_URL`, `APP_BASE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `BLOB_READ_WRITE_TOKEN`, `GITHUB_ACTIONS_DISPATCH_TOKEN`, optional `OHLQ_REPORT_RETENTION_DAYS`, and optional `EVENTBRITE_TOKEN` as environment variables.
- Deploy.

## Tenant configuration
The app defaults to the current Echo Spirits setup. A licensed tenant deployment can override these values with environment variables:
- `TENANT_ID`: stable tenant slug, for example `echo-spirits`.
- `TENANT_ENTITY_NAME`: entity name shown in the app shell and login page.
- `TENANT_APP_NAME`: app name shown in login copy.
- `TENANT_DIGEST_NAME`: name used in weekly digest subjects and headings.
- `TENANT_PRODUCT_LABEL`: short product label, for example `Echo`.
- `TENANT_PRODUCT_PLURAL_LABEL`: plural product label, for example `Echo items`.
- `TENANT_PRODUCT_FILTER_MODE`: `vendor-exclusions` or `item-list`.
- `TENANT_OHLQ_VENDOR_IDS`: comma, semicolon, or newline-separated OHLQ vendor IDs.
- `TENANT_EXCLUDED_ITEM_CODES`: item codes to exclude when using `vendor-exclusions`.
- `TENANT_ITEM_CODES`: explicit item code allowlist when using `item-list`.

Esther Rum tenant values:
```env
TENANT_ID="esther-rum"
TENANT_ENTITY_NAME="Esther Rum"
TENANT_APP_NAME="Esther Rum CRM"
TENANT_DIGEST_NAME="Esther Rum CRM"
TENANT_PRODUCT_LABEL="Esther Rum"
TENANT_PRODUCT_PLURAL_LABEL="Esther Rum items"
TENANT_PRODUCT_FILTER_MODE="item-list"
TENANT_OHLQ_VENDOR_IDS="Z90399001"
TENANT_ITEM_CODES="3150B"
SEED_ADMIN_EMAIL="cheers@echospirits.com"
SEED_ADMIN_FIRST_NAME="Esther"
SEED_ADMIN_LAST_NAME="Admin"
SEED_ADMIN_PASSWORD="<set-a-secure-password>"
```

## OHLQ daily sales and agency inventory export
- Vercel Cron calls `/api/cron/ohlq-annual-sales` daily at 11:07 UTC, which is 7:07 AM Eastern during daylight saving time and 6:07 AM Eastern during standard time.
- The cron route queues the GitHub Actions runner instead of running browser automation inside Vercel. It refreshes yesterday plus the previous report date so early runs can still correct data that posted late the prior day.
- GitHub Actions still owns the browser work in `.github/workflows/ohlq-annual-sales.yml`; it is triggered by Vercel Cron, the Data Status manual import button, or a scheduled GitHub fallback at 7:27 AM Eastern.
- The workflow uses a full Playwright Chromium install instead of Vercel serverless Chromium because the Microsoft/OHID Power BI sign-in flow rejects the serverless session context.
- The Data Status manual import button queues the GitHub Actions runner when `GITHUB_ACTIONS_DISPATCH_TOKEN` is configured in Vercel; production will show a configuration error instead of falling back to the known-bad serverless browser path.
- The automation downloads yesterday's Annual Sales Summary and Annual Sales Summary by Wholesale reports, plus the current Agency Inventory Report.
- The agency summary imports CSV rows into `OhlqAnnualSalesRow`; the wholesale summary imports rows into `OhlqAnnualSalesByWholesaleRow`.
- Qualifying tenant products from Agency Inventory Report are atomically written to `OhlqAgencyInventoryCurrent` and retained by observation day in `OhlqAgencyInventorySnapshot`. A failed, empty, malformed, or unexpectedly sparse report never clears the last valid current state.
- Agency inventory has no report date parameter, so its observation date is the successful download date in `America/New_York`. Sales catch-up dates remain independent.
- The import stores `reportDate` from the report's From date parameter and replaces existing rows for that date, so reruns are idempotent.
- The production cron route refreshes the latest two complete report dates by default. Set `OHLQ_CRON_REFRESH_DAYS` to adjust how many recent dates are force-refreshed; local diagnostic fallback still uses `OHLQ_CRON_CATCHUP_DAYS` and `OHLQ_CRON_MAX_REPORT_DATES`.
- The GitHub scheduled fallback also refreshes the latest two complete report dates by default, using `OHLQ_CRON_REFRESH_DAYS` when that repository variable is set.
- Raw OHLQ report rows are pruned after successful imports. Set `OHLQ_REPORT_RETENTION_DAYS` to adjust the window; the default is 30 report dates.
- Import status is tracked in `OhlqReportImportStatus` and visible to admins at `/admin/data-status`.
- Admins can also manually run or refresh a specific past report date from `/admin/data-status`.
- To configure the scheduled GitHub runner, add these repository secrets: `DATABASE_URL`, `OHLQ_OPS_USERNAME`, `OHLQ_OPS_PASSWORD`, `OHLQ_MICROSOFT_USERNAME`, and `OHLQ_MICROSOFT_PASSWORD`.
- To configure the Data Status manual queue button, add a Vercel env var named `GITHUB_ACTIONS_DISPATCH_TOKEN` with permission to dispatch workflows for this repo.
- To refresh a missed date from GitHub, run the "OHLQ Annual Sales Sync" workflow manually and provide `reportDate` as `YYYY-MM-DD`.

Local command:
```bash
npm run download:ohlq-annual-sales
npm run download:ohlq-annual-sales:wholesale
npm run download:ohlq-agency-inventory
npm run import:ohlq-agency-inventory -- --file "C:\path\Agency Inventory Report.csv" --date 2026-08-18
npm run backfill:ohlq-annual-sales -- --days 7
npm run backfill:ohlq-annual-sales -- --date 2026-05-11
npm run audit:ohlq-storage
```

Required OHLQ env vars:
- `OHLQ_OPS_USERNAME`: OHLQ portal username.
- `OHLQ_OPS_PASSWORD`: OHLQ portal password.
- `OHLQ_INVENTORY_MIN_QUALIFYING_ROWS`: optional safety floor before current inventory can be replaced; defaults to `25`.

The Agency Inventory Power BI report UUID is fixed in code from the confirmed OHLQ report URL. Browser automation signs into OHLQ and Microsoft, leaves the report's pre-set Vendor unchanged, opens the required Brand parameter, checks Select All, runs the report, and exports CSV. Inventory rows are mapped by header name. Identifiers remain strings, blank quantities become `null`, and invalid quantities are skipped and counted. Tenant vendor/item filtering reuses `tenantConfig`; Echo defaults exclude `3150B`, `3750B`, and `4359B`. Rows whose trimmed detail is exactly `A3A Distillery Only` are also excluded. Official agency numbers are normalized and linked when found; unmatched numbers remain in inventory with a null relation and are reported in diagnostics. A valid report is treated as a complete current snapshot, so absent rows are removed only inside the same transaction that writes the validated replacement and daily history.

Reusable inventory reads live in `lib/ohlqAgencyInventory.ts`. They query the compact current-state table for present inventory and the dated snapshot table for history. Both paths reapply the shared tenant-product and distillery-only rules. Inventory joins to agency sales on `agencyNumber = OhlqAnnualSalesRow.agencyId`, `itemCode = OhlqAnnualSalesRow.brand`, and the relevant snapshot/report date window.

## Weekly digest email
- Vercel cron calls `/api/cron/weekly-digest` at 13:00 UTC on Fridays. The route only sends when the current `America/New_York` local hour is 8 or 9, so daylight saving time is handled by the app while staying compatible with Vercel Hobby cron limits.
- The cron route requires `Authorization: Bearer $CRON_SECRET`.
- Standard active users receive their own weekly digest. Active admins receive the team digest for all active users.
- Digest sends are logged in `WeeklyDigestLog` and are idempotent per recipient, digest type, and period.
- Admins can preview and send tests at `/admin/weekly-digest`.

Local commands:
```bash
# Preview in the app
npm run dev
# Then open http://localhost:3000/admin/weekly-digest as an admin.

# Trigger the cron route locally
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/weekly-digest
```

Required email env vars:
- `RESEND_API_KEY`: Resend API key.
- `EMAIL_FROM`: verified sender, for example `Echo Field CRM <crm@echospirits.com>`.
- `APP_BASE_URL`: production app URL used for absolute links in emails.
- `CRON_SECRET`: shared secret for Vercel cron authorization.

## Next build steps
1. Add auth and roles: admin, sales rep, tour guide.
2. Replace local upload paths with Vercel Blob/S3 photo storage.
3. Build CSV import UI for monthly OHLQ files.
4. Finish Eventbrite sync.
5. Add alert rules:
   - bar/restaurant ordered but stopped for 30/45/60 days
   - agency has inventory but no recent retail sales
   - agency has strong sales but low/no inventory
   - tasting completed but no follow-up note
   - menu/display promised but no photo proof
## Calendar integration

Google Calendar OAuth, environment setup, sync behavior, and QA are documented in [docs/google-calendar.md](docs/google-calendar.md).

## Nearby accounts

Optional, session-only device location can surface nearby agencies and active wholesale accounts without changing normal recency sorting or search. Configure the server-only `GOOGLE_MAPS_GEOCODING_API_KEY`, apply the schema migration, then backfill coordinates in safe batches:

```bash
npm run backfill:account-geocodes -- --limit 250
npm run backfill:account-geocodes -- --limit 250 --retry-failed
```

Provider setup, retry behavior, privacy boundaries, and QA are documented in [docs/location-proximity.md](docs/location-proximity.md).
