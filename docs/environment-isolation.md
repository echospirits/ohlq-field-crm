# Production and staging environment isolation

## Safety outcome

`main` is the only production branch. `tst` is the only staging branch. Each branch is deployed as the Production target of its own Vercel project so Vercel Cron, domains, secrets, and integrations are independently scoped. A preview deployment is not staging and must not receive a production or staging database.

The application uses `APP_ENV=production|test|development`; `NODE_ENV` is not an environment identity. `lib/appEnvironment.ts` validates branch/resource labels and the actual `DATABASE_URL` hostname before Prisma connects, defaults every external side effect off outside production, prevents a test URL from matching production, and permanently refuses database reset in production.

## Current-state audit (2026-08-25)

The audit found these production-safety problems before implementation:

- One Vercel project, `ohlq-field-crm`, serves both `main` Production and `tst` Preview. No dedicated staging Vercel project exists.
- `DATABASE_URL` and the complete Neon/Postgres variable set are scoped to Production, Preview, and Development. The same Neon project variables are therefore exposed to `tst` and feature previews.
- `BLOB_READ_WRITE_TOKEN` is scoped to Production, Preview, and Development, so uploads and deletes can share one store.
- OHLQ portal and Microsoft credentials are scoped to both Preview and Production. Preview code can download data and invoke external authentication.
- `GOOGLE_REDIRECT_URI` is shared by Preview and Production while the Google client ID/secret are Production-only. There was no explicit OAuth environment identity.
- Resend, Google Calendar credentials, geocoding, GitHub dispatch, and cron secret are Production-only, but code had no common non-production side-effect policy.
- The GitHub OHLQ workflow used repository-wide secrets and a single concurrency group. A dispatch from another branch could still write through the production `DATABASE_URL` secret.
- Prisma used only `DATABASE_URL`; scripts exposed unguarded `db push` and migration commands, and there was no production reset refusal or target label.
- Authentication is database-backed email/password plus database sessions. Google is Calendar OAuth, not application login. Calendar tokens live in the environment-specific database and are encrypted with `CALENDAR_TOKEN_ENCRYPTION_KEY`.
- Vercel Cron schedules OHLQ imports, weekly digest, and Calendar sync. Cron runs only for a Vercel Production target, which is why staging must be a separate project if staging cron behavior is to be tested faithfully.
- No webhooks are currently registered. Eventbrite is a stub. Google Calendar uses polling rather than webhook channels.

## Required Vercel architecture

### Production project

- Project: existing `ohlq-field-crm`
- Git production branch: `main`
- Domain/base URL: `https://crm.echospirits.com`
- `APP_ENV=production`
- `DATABASE_ENVIRONMENT=production`, `BLOB_ENVIRONMENT=production`, `OAUTH_ENVIRONMENT=production`
- `EXPECTED_DATABASE_HOST` must exactly match the host parsed from the production `DATABASE_URL`.
- Unique production database, Blob store, OAuth client, calendar encryption key, cron secret, Resend key, OHLQ credentials, and GitHub dispatch token
- Side-effect flags explicitly `true` only for capabilities approved for production

Remove database, Blob, OHLQ, OAuth, email, calendar, and cron credentials from this project's Preview and Development scopes. Feature previews should use `APP_ENV=development`, no `DATABASE_URL`, and all side-effect flags `false`. A placeholder non-production `APP_BASE_URL` is acceptable for build-only previews because sends and callbacks are disabled.

### Staging project

- Create a new Vercel project from this repository, for example `ohlq-field-crm-tst`.
- Set its Git production branch to `tst`; do not promote artifacts between the two projects.
- Attach a stable test domain and set that exact value as `APP_BASE_URL`.
- Set `APP_ENV=test`, `DATABASE_ENVIRONMENT=test`, `BLOB_ENVIRONMENT=test`, and `OAUTH_ENVIRONMENT=test`.
- Set `EXPECTED_DATABASE_HOST` to the test database pooler hostname; a pasted production URL then fails startup even if it was mislabeled.
- Set `PRODUCTION_BASE_URL=https://crm.echospirits.com`; startup fails if it matches `APP_BASE_URL`.
- Use independent test resources and secrets. Do not copy production OAuth tokens or calendar connection records.
- Leave all side-effect flags `false` initially. Enable a capability only after its test resource is configured. Non-production email requires `EMAIL_OVERRIDE_RECIPIENT` even when sending is enabled.

The repository's `.vercel/project.json` remains a local link to production. Use a separate checkout/worktree or `vercel --cwd` setup linked to the staging project for staging CLI administration. Never relink the shared working directory casually.

## Database provisioning and migration

Provision an independent Postgres/Neon project or database for staging. Do not create it as a credential alias to production. Record a non-secret label such as `neon-neat-tst` in `DATABASE_TARGET_ID`.

Migration workflow:

1. Create migrations locally with a development database using `prisma migrate dev`; never generate migrations against production.
2. Set test credentials plus `APP_ENV=test` and `DATABASE_ENVIRONMENT=test`, then run `npm run db:migrate:test`.
3. Run tests, build, and staging smoke/QA checks.
4. Set production credentials plus `APP_ENV=production` and `DATABASE_ENVIRONMENT=production`, then run `npm run db:migrate:prod` immediately before the tested production deployment.

`npm run db:push` is forbidden in production and requires one-time `ALLOW_SCHEMA_PUSH=true` elsewhere. `npm run db:reset:test` requires `APP_ENV=test`, matching resource labels, and one-time `ALLOW_DATABASE_RESET=true`; production reset is unconditionally refused. Do not persist either override.

Seed staging only after migrations:

```powershell
$env:APP_ENV='test'
$env:DATABASE_ENVIRONMENT='test'
$env:DATABASE_TARGET_ID='neon-neat-tst'
$env:EXPECTED_DATABASE_HOST='<test database pooler hostname>'
$env:STAGING_ADMIN_PASSWORD='<temporary password of at least 12 characters>'
npm run seed:staging
```

The seed creates only synthetic `.test`/sandbox records. Public OHLQ market data may be imported independently after `OHLQ_IMPORT_ENABLED=true`; private CRM records, sessions, OAuth tokens, calendar tokens, email credentials, and Blob tokens must never be copied. There is no automatic production-to-test clone.

## Environment variable matrix

| Variable | Production | Test/staging | Development/feature preview |
|---|---|---|---|
| `APP_ENV` | `production` | `test` | `development` |
| `DATABASE_URL` | unique production DB | unique test DB | local dev DB or absent in build-only preview |
| `DATABASE_ENVIRONMENT` | `production` | `test` | `development` when a DB is configured |
| `DATABASE_TARGET_ID` | safe production label | safe test label | safe local label |
| `EXPECTED_DATABASE_HOST` | exact production DB hostname | exact test DB hostname | recommended local hostname |
| `APP_BASE_URL` | production domain | stable test domain | localhost or non-production placeholder |
| `PRODUCTION_BASE_URL` | optional | required production domain | recommended |
| `BLOB_READ_WRITE_TOKEN` | production store | separate test store or absent | local/test store or absent |
| `BLOB_ENVIRONMENT` | `production` | `test` | `development` when Blob is configured |
| `CRON_SECRET` | unique production | unique test | absent/local-only |
| `GOOGLE_CLIENT_ID/SECRET` | production OAuth client | separate test OAuth client | local client or absent |
| `GOOGLE_REDIRECT_URI` | production callback | test callback | localhost callback |
| `OAUTH_ENVIRONMENT` | `production` | `test` | `development` when Google OAuth is configured |
| `CALENDAR_TOKEN_ENCRYPTION_KEY` | unique/stable production | different unique/stable test | local-only |
| `RESEND_API_KEY` / `EMAIL_FROM` | production sender | sandbox/test sender or absent | absent/local-only |
| `EMAIL_SEND_ENABLED` | `true` | `false` initially | `false` |
| `EMAIL_OVERRIDE_RECIPIENT` | must be absent | required if sends enabled | required if sends enabled |
| `EMAIL_CAPTURE_CONTENT` | `false` | optional explicit debugging | optional explicit debugging |
| `CALENDAR_SYNC_ENABLED` | `true` | `false` until test OAuth exists | `false` |
| `CRON_JOBS_ENABLED` | `true` | `false` initially | `false` |
| `OHLQ_IMPORT_ENABLED` | `true` | `false` until test workflow exists | `false` |
| `FILE_UPLOADS_ENABLED` | `true` | `false` until test Blob exists | `false` |
| `WEBHOOK_REGISTRATION_ENABLED` | `false` (unused) | `false` | `false` |
| OHLQ credentials | production only | separate approved test credentials or absent | absent |
| `GITHUB_ACTIONS_DISPATCH_TOKEN` | production project only | staging project only | absent |
| `GITHUB_ACTIONS_REF` | `main` | `tst` | absent |

There is no `AUTH_SECRET`; sessions are random tokens hashed into the selected database. Environment database isolation therefore also isolates sessions and users.

## OAuth callback URLs

Configure separate Google OAuth Web clients. Exact authorized redirect URIs are:

- Production: `https://crm.echospirits.com/api/calendar/google/callback`
- Test: `${TEST_APP_BASE_URL}/api/calendar/google/callback` (replace with the stable staging domain before enabling Calendar)
- Local: `http://localhost:3000/api/calendar/google/callback`

Production credentials must not authorize the test callback; test credentials must not authorize the production callback. Test users connect test Google accounts after the staging database is provisioned. Never copy `CalendarConnection` or `CalendarOAuthState` rows.

## Email, cron, Calendar, OHLQ, and storage behavior

- Email is enabled by default only in production. Disabled sends are logged with environment, intended recipient, and subject; body capture requires explicit `EMAIL_CAPTURE_CONTENT=true`. Enabled non-production sends are forcibly rerouted to `EMAIL_OVERRIDE_RECIPIENT` and prefixed with the intended recipient.
- Cron endpoints still require their environment's unique `CRON_SECRET`. They return a successful suppressed result when cron or the capability is disabled.
- Calendar OAuth and sync are unavailable when `CALENDAR_SYNC_ENABLED=false`. Worklist writes continue without external Calendar mutation.
- OHLQ cron/manual imports are unavailable when `OHLQ_IMPORT_ENABLED=false`. GitHub dispatch selects `main/production` or `tst/test` from `APP_ENV` and rejects mismatches.
- GitHub repository secrets must be moved into GitHub Environments named `production` and `test`. Scheduled fallback always selects `production`; test runs are manual/app-dispatched only.
- Blob upload, metadata lookup, and deletion are blocked when `FILE_UPLOADS_ENABLED=false`. Staging must use a separate Blob store before enabling uploads.

## Cutover checklist

1. Provision the staging database and Blob store; record only safe target labels in diagnostics.
2. Create the staging Vercel project, set production branch `tst`, attach a stable domain, and add the test matrix.
3. Add explicit production identity/resource labels and flags to the existing project before deploying this guard code.
4. Create separate Google OAuth clients and callbacks; use a test Google account in staging.
5. Create GitHub Environments `production` and `test`; move secrets into each and require review for production if desired.
6. Remove all production credentials from Preview/Development scopes in the production Vercel project.
7. Apply migrations to staging, seed synthetic data, deploy `tst`, and verify `/api/health` plus `/admin/environment`.
8. Run staging QA, then apply the same tested migration to production and deploy `main`.
9. Verify production shows no environment banner and staging shows `NEAT — TEST ENVIRONMENT`.
10. Create a record in each environment and confirm it is absent from the other. Confirm test email/calendar/upload/import behavior remains suppressed until explicitly enabled with test resources.

Do not deploy this change to production before steps 2 and 3 are complete: the fail-closed validator intentionally rejects unlabeled Vercel resources.
