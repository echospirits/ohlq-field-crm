# Neat Release Checklist

Release version: ______  Candidate commit: ______  Production base: ______

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes for the release environment.
- [ ] `npm run release:check` output and `UNRELEASED.md` are reviewed.
- [ ] Every migration is understood; destructive changes, backfills, and backward incompatibilities are explicitly handled.
- [ ] Required production environment/configuration is present without exposing secret values.
- [ ] Tenant isolation smoke test passes.
- [ ] Feature entitlements and default activation states are correct, including pilot-only features.
- [ ] Mobile smoke test is complete at 390 x 844, including relevant loading, empty, error, disabled, and success states.
- [ ] Desktop smoke test is complete at a representative viewport.
- [ ] Internal and user-facing release notes are reviewed.
- [ ] The exact production commit and version are recorded and match the tested candidate.
- [ ] Post-deploy environment, database target, health, and affected routes are verified before tagging.
