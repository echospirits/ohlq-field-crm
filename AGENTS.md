# Repository Agent Instructions

## Release Rules

### Feature development

- Work in TST for normal feature and fix work. Do not push or merge to production/main unless the user explicitly invokes a production release or hotfix.
- Update `docs/releases/UNRELEASED.md` for meaningful features, fixes, migrations, environment/configuration changes, feature flags, and externally visible behavior.
- Follow `docs/RELEASE_PROCESS.md`; feature work stops after it is tested, committed, pushed to TST, and documented for the next release.

### Production releases

- Treat production promotion as a distinct release task. Determine the release contents by comparing actual Git/repository states and the unreleased manifest, never by relying on conversational memory.
- Promote only the exact tested release state and follow `docs/releases/RELEASE_CHECKLIST.md`.

## Neat UI/UX Requirements

For every implementation that changes user-facing UI:

- Read and follow `docs/UI-UX-GUIDELINES.md` before designing or editing the interface. Adherence is part of feature completion.
- Design mobile-first for field workflows, then verify the desktop experience for deeper work.
- Reuse existing shared components and established patterns before adding one-off controls or layouts.
- Preserve known account, contact, product, task, owner, and return context. Do not make users search for or re-enter information Neat already knows.
- Minimize taps, page changes, scrolling, dropdown openings, and text entry. Keep the primary action obvious and close to the information that motivates it.
- Use live search for finding or selecting records. Avoid large native dropdowns when a searchable picker, chips, or a short inline choice is clearer.
- Apply progressive disclosure to optional fields, setup help, evidence, raw metadata, and secondary detail.
- Clearly distinguish clickable, editable, disabled, and static elements, and explain unavailable actions or data.
- Do not allow unintended horizontal page scrolling on mobile.
- Verify the UI at 390 x 844 and a representative desktop viewport, including loading, empty, error, disabled, and success states relevant to the change.
