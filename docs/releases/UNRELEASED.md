# Unreleased

No pending changes after the 0.13.3 production hotfix.

- Current production: `0.13.3`, tag `v0.13.3`.
- Archived release: [0.13.3.md](0.13.3.md) and [completed hotfix checklist](0.13.3-checklist.md).
- TST continues its separate `0.14.0-dev` cycle. Its unreleased manifest tracks development work that is excluded from this hotfix.

## Entry template

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
