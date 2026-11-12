# Neat engineering and product documentation

Production Supplies **0.10.0** is released to production as application `3503020a33b9f20778d26b4ee51685875304b343`, READY with correct connected production health. It selectively adds the accepted Dx5-driven status dashboard and Production navigation, with tests/typecheck/build/browser/exact Node 22 CI and the additive migration readback passing. TST Tasting Management and concurrent Social Publishing remain excluded. The separately approved Echo [production activation](releases/production-supplies-production-activation.md) has the three existing Production members, isolated credentials, Joe's read-only Gmail and a verified worker; Karl/Nikhil consent and full historical import remain incomplete, and paid tracking is disabled. Development remains frozen. See [release validation](releases/0.10.0-validation.md), [release](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.10.0) and [operator guide](production-supplies.md).

Start with [implementation progress](engineering/implementation-progress.md) and [feature inventory](product/feature-inventory.md). Existing canonical release and UI standards remain authoritative.

## Current release

**0.9.2 is verified on TST and production; development remains frozen.** Manual forecast refresh now retrieves current warehouse stock and appends inventory history. Both real refreshes confirm 2802B GPT 37 / GRN 18, retaining all prior facts and protected sales/shared-inventory data. Exact CI, tests/typecheck/build, scoped migrations and affected UI evidence pass. Published [v0.9.2](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.9.2) is verified Latest at production application `0f890cc0063bfa94cec16874c2135a9767a8e37e`. See [notes](releases/0.9.2.md), [checklist](releases/0.9.2-checklist.md) and [validation](releases/0.9.2-validation.md) for exact receipts and UI evidence limits. Unrelated TST work remains excluded; earlier release statements below are historical.

**0.9.1 is verified on TST and production; development remains frozen.** Production application `8213292340562cd27781f21afe5988cb17e10221` and TST `c7bdd30baee4f6dcc6f7826a0a6019c61a2a3bb3` are READY with correct connected database health. Exact-candidate Node 22/npm 10 CI, 1,176 main / 1,271 TST tests, typechecks/builds and real Admin refreshes pass. TST confirms fresh GPT/GRN delivery recovery; production succeeds after the orderly provider-lock wait and reuses existing dated daily operational snapshots. Actual new TST mobile/desktop success preserves product/horizon without page overflow. Protected product/configuration/sales/shared-inventory boundaries remain unchanged. The owner-approved TST-only Neon auto-branch toggle fixes the frontend provisioning issue without changing databases, connection URIs or secrets. Published [v0.9.1](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.9.1) is verified Latest at the exact production application; historical 0.9.0 gaps are now resolved. See [notes/manifest](releases/0.9.1.md), [checklist](releases/0.9.1-checklist.md) and [validation](releases/0.9.1-validation.md). No new development cycle is opened.

**0.9.0 is released to production; development remains frozen.** Admins can refresh Production Forecasting from the current page, follow persisted progress and see saved forecasts without uploading files. Production application `13110b06c942ae57faf24fdc8da1b2383f1cacfd` is READY with correct database health; exact-candidate CI, 1,170 tests/77 suites, typecheck/build, additive migration and live Admin desktop refresh pass. Actual-component mobile/desktop fixtures cover the relevant states. Stable TST is deployed and healthy, but its button remains disabled pending its runtime credential; TST live-provider acceptance is open. Published [v0.9.0](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.9.0) points to the exact production application and is verified Latest. Source dates, daily observations, sales/shared-inventory boundaries and unrelated TST work remain preserved. No new development cycle is opened. See [release notes](releases/0.9.0.md), [checklist](releases/0.9.0-checklist.md) and [validation](releases/0.9.0-validation.md). Earlier release statements remain historical.

**0.8.0 is deployed to production; development remains frozen.** Owner-approved GPT/GRN demand, warehouse inventory/balances and the My Schedule shortfall widget are released as application `3a21899c523c52c226b8ee3d905abbbe057504d5`. Production is READY with correct database health; exact-candidate CI, 1,125 tests/77 suites, typecheck/build, additive migration and live provider/Admin mobile/desktop acceptance pass. Sales authorization/rendering is covered by tests and fixtures. Unrelated TST Tastings and maintenance remain excluded. No new development cycle is opened. See [release notes](releases/0.8.0.md), [checklist](releases/0.8.0-checklist.md) and [validation](releases/0.8.0-validation.md). Earlier release statements remain historical.

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
