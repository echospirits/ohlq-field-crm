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
- Add `DATABASE_URL`, `APP_BASE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `BLOB_READ_WRITE_TOKEN`, `OHLQ_OPS_USERNAME`, `OHLQ_OPS_PASSWORD`, optional `OHLQ_REPORT_RETENTION_DAYS`, and optional `EVENTBRITE_TOKEN` as environment variables.
- Deploy.

## OHLQ annual sales export
- GitHub Actions runs `.github/workflows/ohlq-annual-sales.yml` at 12:00 UTC daily, which is 8:00 AM Eastern during daylight saving time.
- The workflow uses a full Playwright Chromium install instead of Vercel serverless Chromium because the Microsoft/OHID Power BI sign-in flow rejects the serverless session context.
- The Vercel cron route `/api/cron/ohlq-annual-sales` remains available for protected manual/diagnostic calls, but it is not scheduled in `vercel.json`.
- The Data Status manual import button queues the GitHub Actions runner when `GITHUB_ACTIONS_DISPATCH_TOKEN` is configured in Vercel; otherwise it falls back to the in-app runner for local/dev use.
- The automation downloads yesterday's Annual Sales Summary and Annual Sales Summary by Wholesale reports.
- The agency summary imports CSV rows into `OhlqAnnualSalesRow`; the wholesale summary imports rows into `OhlqAnnualSalesByWholesaleRow`.
- The import stores `reportDate` from the report's From date parameter and replaces existing rows for that date, so reruns are idempotent.
- The Vercel cron route checks recent report dates before running and imports missing dates first. Set `OHLQ_CRON_CATCHUP_DAYS` and `OHLQ_CRON_MAX_REPORT_DATES` to adjust the catch-up window and per-run limit if using that route for diagnostics.
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
npm run backfill:ohlq-annual-sales -- --days 7
npm run backfill:ohlq-annual-sales -- --date 2026-05-11
npm run audit:ohlq-storage
```

Required OHLQ env vars:
- `OHLQ_OPS_USERNAME`: OHLQ portal username.
- `OHLQ_OPS_PASSWORD`: OHLQ portal password.

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
