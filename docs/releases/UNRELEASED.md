# Unreleased

No pending changes after the 0.13.0 production release.

- Current production: `0.13.0`, tag `v0.13.0`.
- Archived release: [0.13.0.md](0.13.0.md).
- The next development cycle has not been opened. Choose its version deliberately before new feature work; package.json remains 0.13.0.

## Entry template

## Pending hotfix: 0.13.3

- Description: OHLQ report re-login accepts the requested Power BI report or Microsoft authentication handoff instead of requiring the partner homepage. Resumes the authenticated report without another redirect/login cycle.
- Relevant commits: production-base hotfix, to be recorded after validation.
- Feature flag: None. Existing import/environment guards remain in force.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes; prevents false timeout failures and incomplete scheduled refreshes.
- Production readiness: Production passed 529 tests, typecheck and build; TST passed 557 tests, typecheck and build. Deployment verification pending.
- Rollout notes: Promote only the production-base 0.13.3 hotfix. Unrelated 0.14.0-dev changes are excluded. No credential repair or database mutation is required.

### Feature/change name

- Description: What changed and why.
- Relevant commit(s): Short SHA(s) from TST.
- Feature flag: Key, or `None`.
- Default flag state: Enabled, disabled, pilot-only, or `N/A`.
- Migration(s): Path(s), or `None`.
- Environment/config: New or changed variable names, or `None` (never include values or secrets).
- User-visible: Yes or no.
- Production readiness: Ready, blocked, or not reviewed, with a short reason.
- Rollout notes: Anything the release operator must do, or `None`.
