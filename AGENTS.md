# Repository Agent Instructions

## Current release: 0.7.0; development frozen

The owner-approved Echo-informed interface upgrade is deployed as stable **0.7.0** to TST and main on November 4, 2026. Production application commit is `5023578de6bfda370ea547af7b1cb5494bbdfe70`; stable TST application is `214e0fe0cfb7d3184416408ea400ab0a023f7951`. Both deployments are READY with their correct production/test database targets. Authenticated production mobile/desktop acceptance passed, and annotated `v0.7.0` peels to the exact production application commit. See [validation](docs/releases/0.7.0-validation.md) and the [completed checklist](docs/releases/0.7.0-checklist.md) for the release receipts and evidence limits. See [release notes](docs/releases/0.7.0.md), [plan](docs/releases/0.7.0-plan.md) and [UNRELEASED](docs/releases/UNRELEASED.md). Development remains frozen; no new development cycle is opened. The selective release preserves production forecasting/Operational Signals behavior and main's existing tests, package scripts, TypeScript configuration and CI workflow. Unrelated TST maintenance remains excluded. No schema/migration, dependency upgrade, provider/credential or hosted configuration change was included. Preserve all historical candidate/release refs and records. Earlier authorization/release statements below are historical.

## Released baseline: 0.6.0

Owner-authorized exception completed: this chat's Production Forecasting Operational Signals changes were selectively promoted from tested TST `ef41fe8fb5810dd52cadfecab09dd4d8d995a829` to main application `c94f5c3ef6f35e74f46648445571ba970136ecb0`. Version `0.6.0` is retained; no new development cycle or release tag was created, the statistical forecast model is unchanged, and unrelated TST maintenance remains excluded. Production OpenDock activation and authenticated desktop/tablet/mobile acceptance are verified. See `docs/releases/production-operational-signals-promotion.md` for production validation and the initial background demand-ingestion status. Historical release refs remain unchanged.

The owner-authorized 30/60/90-day Production Forecasting changes and approved exact invoice exclusion are released as **0.6.0** to TST and main. Both deployments and database targets are verified; production application commit `c5dcf07b8cc775488a3be9b69766e748bad3fb6f` is tagged `v0.6.0`. See [release notes](docs/releases/0.6.0.md), [completed checklist](docs/releases/0.6.0-checklist.md) and [validation](docs/releases/0.6.0-validation.md). Unrelated TST test/developer-tooling maintenance remains excluded from production. Development remains frozen; no new cycle is opened. Preserve all historical candidate/release refs. Earlier release statements below describe prior releases.

The Account Research inline-edit hotfix is released as **0.5.2** to TST and main; see [hotfix notes](docs/releases/0.5.2.md) and [validation](docs/releases/0.5.2-validation.md). The account-address location-link hotfix is released as **0.5.1**; see [its notes](docs/releases/0.5.1.md). The authorized interface, navigation and application-wide UI/UX and performance improvements are released as **0.5.0** to TST and main. Development remains frozen; no new development cycle is opened. See [release notes](docs/releases/0.5.0.md), [checklist](docs/releases/0.5.0-checklist.md), [validation](docs/releases/0.5.0-validation.md) and [UNRELEASED](docs/releases/UNRELEASED.md). Historical candidate/release refs remain preserved. No unrelated features, dependency upgrades or migrations were included in 0.5.2.

Preserve the historical 0.3.0 and 0.4.0 candidate/release refs and records. See [0.4.0 release notes](docs/releases/0.4.0.md), [checklist](docs/releases/0.4.0-checklist.md) and [validation](docs/releases/communications-retirement-validation.md). Communications runtime integrations are retired; stored records/migrations remain. This work does not authorize database deletion, provider-account changes or hosted configuration changes.

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

## Product and architecture

Neat is a multi-tenant beverage sales operating system. Optimize durable relationships, retention and completed commitments rather than raw activity volume. Capture evidence automatically when practical; preserve human judgment. Read docs/README.md and docs/engineering/implementation-progress.md before substantial work.

- Stack: Next.js App Router, React, strict TypeScript, Prisma, Neon PostgreSQL, Vercel. app/ contains routes and UI; lib/ owns domain services; prisma/ owns schema/migrations; tests/ uses node:test through tsx.
- Resolve authenticated user and organization on the server. Scope private reads, writes, jobs, imports, exports and AI retrieval. Shared Ohio directories are platform-curated. Support View does not authorize private mailbox access.
- Preserve backwards compatibility and raw external IDs. Prefer additive migrations; no destructive shared database changes without explicit approval. Verify target identity and rehearse migrations.
- Providers use typed adapters, encrypted tokens, bounded retries, persisted checkpoints and idempotency. Mock mode must be visibly distinct from live mode. Never log secrets or send AI correspondence automatically.
- Worklist is the follow-up source of truth. Email initiation is not completed contact and is never a physical visit. Missing data is unknown, not zero. No CFAO engine; manual analytical tags remain supported.
- Validate inputs with Zod, retain strict types, reuse UI/domain components, and preserve source provenance. Update relevant docs, ADRs and UNRELEASED for significant changes.
- Definition of done: persisted data and backend behavior, usable authorized UI, error states, passing relevant behavioral/security tests, typecheck/build, migration checks, mobile/desktop acceptance and honest release evidence. Never claim mocked providers are live or the full project complete while substantive inventory gaps remain.

## Integrate before extending

Reuse existing workflows and their canonical actions. Pipeline owns account sales progress; Log Visit owns manual interaction capture; account Contacts owns relationship management; Worklist owns tasks and next actions. Do not reintroduce standalone Deals or Activities workflows. Preserve physical visit semantics, tenant scope, idempotency, history, calendar side effects, and return context when extending a flow. See docs/decisions/0012-integrate-existing-workflows.md.
