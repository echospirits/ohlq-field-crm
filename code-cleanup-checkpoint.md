# Code cleanup checkpoint

## Completed

- Replaced 11 duplicated environment-file loaders with one tested helper while retaining precedence and escaped-newline behavior.
- Reused the shared timezone utility for OHLQ report, cron, manual-import, and Data Status dates.
- Removed compiler-proven unused imports, variables, redirect logic, and a superseded wholesale-reactivation query path.

## Material files

- `lib/environmentFile.ts`
- Operational scripts that load local environment files
- OHLQ date/status helpers
- Files containing compiler-proven unused code

## Tests run

- Focused regressions: 28/28 passed.
- Full suite: 332/332 passed.
- Strict unused-code typecheck: passed.
- Optimized production build: passed with explicit local development resource labels.
- No lint script is configured.

## Remaining

- Commit and push only to `staging/tst`.

## Deliberately left alone

- Tenant/feature authorization semantics, Prisma schema, and large intelligence workflows.
- Similar-looking OHLQ identifiers whose normalization rules differ by dataset.
- Large UI files without a low-risk extraction boundary; defer to the separate UI/UX review.
