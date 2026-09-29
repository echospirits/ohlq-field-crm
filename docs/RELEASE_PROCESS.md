# Neat Release Process

Neat uses `0.X.0-dev` while TST is open for development toward a planned `0.X.0` feature release, and `0.X.Y` for a stable bugfix or hotfix release. Remove the `-dev` suffix only when establishing the exact release candidate. `package.json` is the canonical application version source; generated lockfile metadata may mirror it.

## Feature development: TST only

1. Build and test the feature or fix.
2. Commit and push it to the dedicated `neat-tst` repository's `tst` branch.
3. Add a concise entry to `docs/releases/UNRELEASED.md`.
4. Stop. Do not promote normal development work to production/main.

Deployment and activation are separate. Code may ship while existing feature entitlements keep it disabled globally, enabled only for pilot tenants, or enabled later without another deployment. Do not bypass entitlement checks during release work.

## Release preparation

1. Fetch both repositories and run `npm run release:check` to compare production with TST.
2. Review the Git commit/file comparison and every `UNRELEASED` entry.
3. Identify migrations, backfills, environment/configuration requirements, feature-flag defaults, and rollout notes.
4. Choose the exact TST commit and version that form the release candidate. Freeze that candidate from unrelated feature work.

## Release candidate

Complete `docs/releases/RELEASE_CHECKLIST.md` against the exact candidate. At minimum, run tests, typecheck, build, migration checks, a tenant-isolation smoke test, and mobile and desktop smoke tests. Any candidate change requires rerunning the affected checks.

Prefer backward-compatible migrations. Flag destructive SQL, table or column removals, required backfills, and changes that make the prior application version incompatible. Use expand/migrate/contract across releases where practical.

## Production

1. Promote the exact tested candidate state through the repository's existing selective production workflow; do not merge unrelated TST history.
2. Verify the production deployment, environment identity, database target, and health endpoint.
3. Tag the deployed production commit `v<version>` only after it is verified.

## After release

1. Copy `UNRELEASED.md` to `docs/releases/<version>.md`, preserving the internal technical manifest.
2. Add concise user-facing **New**, **Improved**, and **Fixed** notes to the archived file.
3. Reset `UNRELEASED.md` to its empty template and begin the next version deliberately.
4. Advance TST to the next planned `0.X.0-dev` version before new feature work begins.

## Hotfixes

For an urgent production defect, branch from the current production commit, make the smallest safe fix, increment `0.X.Y`, and document it. Test/typecheck/build and run the risk-relevant checklist items. Promote only that hotfix commit, verify production, tag it, archive its notes, then bring the fix back into TST so the branches do not regress.

## Topology note

The current dedicated `neat-tst/tst` and production `ohlq-field-crm/main` setup is supported. A future move to one repository with protected, branch-based deployments could simplify comparisons, but it is not required and must not be combined with a feature release.
