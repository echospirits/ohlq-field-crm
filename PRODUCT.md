# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Neat currently serves Echo Spirits. Field sales representatives are the primary users: they work between accounts, often on a phone with limited time and one free hand. They need fast account lookup, visit preparation, contact actions, visit logging and reliable follow-ups.

Sales managers use desktop for account development, retention, Pipeline and outcome review. Echo administrators manage users and allowed configuration. Tasters have restricted field and visit workflows; preserve their role boundaries.

## Product Purpose

Neat is Echo Spirits' sales operating system. Help the team develop durable account relationships, retain customers and complete commitments. Success means useful next actions and sustained account outcomes, rather than higher raw activity counts.

## Positioning

Combine beverage account context and source-backed sales/inventory intelligence with the team's existing field workflows. Ohio OHLQ Retail and Restaurants data, tenant account knowledge and follow-up commitments inform decisions in the account where the rep can act. Recommendations support human judgment and must show their evidence and limits.

## Operating Context

- Mobile is the primary daily work environment. My Schedule, Account Search, account/contact actions, Log Visit and Worklist support work between stops.
- Desktop supports deeper comparison, Analytics, Production Forecasting, imports, configuration and administration, subject to existing permissions and feature gates.
- Pipeline owns account sales progress; Log Visit owns manual interaction capture; account Contacts owns relationship management; Worklist owns tasks and next actions. Extend these canonical workflows rather than creating standalone Deals or Activities surfaces.
- Carry reliable account, contact, product, task, owner and return context into actions, and return users to the originating workflow.

## Capabilities and Constraints

- Existing workflows include account search and profiles, notes and Contacts, manual interactions and history, account briefing, Pipeline, Worklist/calendar, events, orders and sales intelligence. Visibility depends on authorization, role and existing feature gates; navigation is not proof of entitlement.
- Communications is retired in the current TST work: connected mailbox capture, imported appointments, business SMS, contact suggestions and the communication assistant must not be reintroduced. Ordinary contact links, manual call/email/text logging, retained history and independent Worklist calendar synchronization remain. Support and Recipes are also retired; historical documentation is not a current feature promise.
- Echo-only access is the current product scope. Existing multi-tenant persistence and organization scoping remain architectural safeguards; they do not imply a customer-onboarding or multi-tenant expansion roadmap.
- Resolve authenticated user and organization on the server. Preserve private-data isolation, role checks, source provenance, raw external IDs, idempotency and calendar side effects.
- Initiating a phone, email or text action does not prove completed contact. Nonphysical contact is never a physical visit. Placement commitments, verified placement, first orders and sustained purchasing are distinct facts.
- Missing, partial, stale and unavailable data must be distinguished from a true zero. Bottle-only sales data does not establish transaction counts or verified revenue forecast accuracy. Relationship health is an explained indicator, not a validated predictive model.
- Preserve historical records and migration history during retirement. No database deletion, provider-account changes or production configuration changes are implied.
- No CFAO engine; manual analytical tags remain supported. Do not send AI correspondence automatically or describe fixture/mock behavior as a live provider integration.
- The current authorized development scope and release boundaries live in [AGENTS.md](AGENTS.md), [the 0.7.0 interface upgrade plan](docs/releases/0.7.0-plan.md) and [UNRELEASED](docs/releases/UNRELEASED.md). This interface upgrade targets TST for owner review; production promotion requires separate explicit authorization. Preserve historical frozen refs and release records.

## Brand Commitments

The product name is **Neat**, for **Echo Spirits**. Preserve these identities and existing product terminology. Use plain, concise, action-oriented language that explains what happened and what to do next. Existing brand definitions are in `lib/appBrand.ts`; existing names and organization branding are used by `app/layout.tsx` and the sign-in experience. The owner-approved UI/UX Guidelines adapt Echo's Copper, Patina and Chalkboard identity for an accessible working interface; brand source swatches are not interchangeable with operational status colors. Follow the canonical guidelines when improving shared presentation rather than treating the current appearance as fixed.

## Evidence on Hand

- [UI/UX guidelines](docs/UI-UX-GUIDELINES.md): canonical interaction requirements and UI acceptance criteria.
- [Product principles](docs/product/product-principles.md), [personas](docs/product/personas.md) and [product vision](docs/product/product-vision.md): product background; interpret older audits alongside current scope.
- [Feature inventory](docs/product/feature-inventory.md) and [implementation progress](docs/engineering/implementation-progress.md): source locations, historical delivery evidence and explicit limitations. Historical provider implementations are not current activation evidence.
- [Workflow ownership decision](docs/decisions/0012-integrate-existing-workflows.md): canonical workflow boundaries.
- [Accessibility guidance](docs/design/accessibility.md): interaction requirements and known verification limits.
- `app/components/navigationConfig.ts`, `app/layout.tsx`, shared components and application styles provide interface evidence. [DESIGN.md](DESIGN.md) records the implemented shared system; the approved guideline direction and current release scope govern changes.
- Test and release artifacts distinguish fixture/isolated validation from live acceptance. Do not invent testimonials, adoption, pricing, performance claims or live-provider success.

## Product Principles

1. Prioritize durable relationships, retention and completed commitments.
2. Make the next useful action obvious and preserve the context needed to complete it.
3. Reduce repeated entry and interaction cost; disclose supporting depth when needed.
4. Keep source evidence, uncertainty and human judgment visible.
5. Integrate through canonical workflows while preserving privacy, history and side effects.

## Accessibility & Inclusion

Design mobile-first and verify relevant workflows at 390 x 844 and a representative desktop viewport. Prevent unintended horizontal page scrolling. Preserve visible labels, semantic controls, keyboard access and visible focus. Frequent touch targets must be at least 44 CSS pixels. Status must have text beyond color; announce save errors and success, retain entered values after errors, and manage dialog focus and Escape behavior. Verify relevant loading, empty, error, disabled and success states. Viewport screenshots alone do not establish accessibility conformance.

## Open Decisions

No additional audience, accessibility standard or product expansion is established by initialization. Any future change to the confirmed Echo-only brief needs explicit product direction. Runtime provider availability and release readiness require their own current evidence.
