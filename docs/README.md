# Neat engineering and product documentation

Start with [implementation progress](engineering/implementation-progress.md) and [feature inventory](product/feature-inventory.md). Existing canonical release and UI standards remain authoritative.

## Current release

**0.7.2 is deployed to production; development remains frozen.** The focused Wholesale Orders repair bridges supplier name/vendor-code formats, honors explicit permit aliases and preserves manual filing reservations. Production application `12c1d995114203609bb92f833449138ec22bd52c` is READY with correct database health. All six reviewed pending orders were automatically filed, with zero additional filings on replay and unchanged Sent/Paid, original snapshots/PDFs and four manual filing records. Exact-candidate CI, 1,066 tests, typecheck and build passed. Signed-in production UI acceptance remains explicitly unverified; application UI blobs are unchanged and unauthenticated route/PDF checks pass. See [notes](releases/0.7.2.md), [checklist](releases/0.7.2-checklist.md), [validation](releases/0.7.2-validation.md) and [UNRELEASED](releases/UNRELEASED.md). No migration, dependency graph, hosted configuration or feature-flag change; historical releases below remain preserved and no new development cycle is opened.

**0.7.1 is deployed to production; development remains frozen.** The owner-approved focused quality-of-life patch adds optional post-Visit Worklist completion, removes the Opportunity interruption, improves Agency identity/inventory placement and overdue alignment, and gives Reactivation Follow-ups tenant-scoped Visit/fallback ownership. Production application `066b66ead25095c138ed2f5bd5b739e64ea55ec3` is READY with correct database health and authenticated mobile/desktop acceptance. See [notes](releases/0.7.1.md), [checklist](releases/0.7.1-checklist.md), [validation](releases/0.7.1-validation.md) and [UNRELEASED](releases/UNRELEASED.md). No migration, dependency or hosted environment change; historical releases below remain preserved and no new development cycle is opened.

**0.7.0 is deployed to TST and production; development remains frozen.** The owner-approved interface upgrade is selectively promoted as production application `5023578de6bfda370ea547af7b1cb5494bbdfe70`, with stable TST `214e0fe0cfb7d3184416408ea400ab0a023f7951`. Both deployments are READY with healthy, correctly scoped database targets. See [release notes](releases/0.7.0.md), [checklist](releases/0.7.0-checklist.md), [validation](releases/0.7.0-validation.md) and [application audit](design/neat-tst-ui-audit-2026-11-04.md) for completed checks, verified production mobile/desktop acceptance, the `v0.7.0` tag receipt and evidence limits. Main's existing coverage/tooling and Operational Signals behavior are retained; no migration, dependency upgrade or provider/configuration change belongs to this release. No new development cycle is opened.

**0.6.0 is released to TST and production; development remains frozen.** The cumulative forecasting horizons, historical evidence and approved exact source-line exclusion are verified in production. See [release notes](releases/0.6.0.md), [completed checklist](releases/0.6.0-checklist.md), [validation](releases/0.6.0-validation.md) and [UNRELEASED](releases/UNRELEASED.md). Unrelated TST test/tooling remains excluded from production. Historical [0.5.2](releases/0.5.2.md) and [0.5.0](releases/0.5.0.md) release records remain preserved; Communications runtime integrations remain retired. No new development cycle is opened.

## architecture

- [System overview](architecture/system-overview.md)
- [Architecture principles](architecture/architecture-principles.md)
- [Database design](architecture/database-design.md)
- [Multi-tenancy](architecture/multi-tenancy.md)
- [Authentication and authorization](architecture/authentication-authorization.md)
- [Integration architecture](architecture/integrations.md)
- [Activity engine](architecture/activity-engine.md)
- [Automation engine](architecture/automation-engine.md)
- [AI architecture](architecture/ai-architecture.md)
- [Background jobs](architecture/background-jobs.md)
- [Security and privacy](architecture/security-privacy.md)
- [Deployment architecture](architecture/deployment.md)

## product

- [Product vision](product/product-vision.md)
- [Product principles](product/product-principles.md)
- [Personas](product/personas.md)
- [Account management](product/account-management.md)
- [Communication management](product/communication-management.md)
- [Opportunity management](product/opportunity-management.md)
- [Sales intelligence](product/sales-intelligence.md)
- [Field execution](product/field-execution.md)
- [Events and tastings](product/events-and-tastings.md)
- [Retired Recipes design history](product/recipe-management.md)
- [Management reporting](product/management-reporting.md)
- [Multi-tenant configuration](product/multi-tenant-configuration.md)

## design

- [Design system](design/design-system.md)
- [Navigation](design/navigation.md)
- [Account detail experience](design/account-detail-experience.md)
- [Dashboard experience](design/dashboard-experience.md)
- [Mobile experience](design/mobile-experience.md)
- [Accessibility](design/accessibility.md)

## engineering

- [Coding standards](engineering/coding-standards.md)
- [Testing strategy](engineering/testing-strategy.md)
- [Integration testing](engineering/integration-testing.md)
- [Database migrations](engineering/database-migrations.md)
- [Engineering release process](engineering/release-process.md)
- [Developer setup](engineering/developer-setup.md)
- [Troubleshooting](engineering/troubleshooting.md)

- [Architecture decisions](decisions/README.md)
- [Extended v0.2 plan](releases/v0.2-plan.md)
- [Test report](releases/v0.2-test-report.md)
- [Release notes](releases/v0.2-release-notes.md)

## CRM operator guides

- [Integration setup and Communications retirement](engineering/integration-setup.md)
- [CRM migration runbook](engineering/crm-migration-runbook.md)
- [CRM security review](engineering/crm-security-review.md)

- [Retail/Restaurants state access and ABC release runbook](releases/0.2.0-state-access-validation.md)

- Communications, business SMS, contact suggestions and the communication assistant are retired in 0.4.0; see [retirement validation](releases/communications-retirement-validation.md). Historical product/release records remain for provenance.
