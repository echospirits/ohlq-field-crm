# Agency Retail + Wholesale Intelligence V1

## Purpose

Agency Intelligence answers which Echo item needs attention at an Agency, what action to take, and which observed facts support that action. Retail opportunity and linked-wholesale influence remain separate dimensions and are synthesized only in the Agency summary.

## Persisted architecture

- `AgencyProductIntelligence` is the current Agency × Echo item read model. It stores inventory, 7/30-day retail sales, fit, peer metrics, opportunity/action state, explanations, rule versions, and the complete signal snapshot used for the recommendation.
- `AgencyIntelligenceSummary` is the fast Agency-level read model used by Agency pages and dashboard counts.
- `AgencyIntelligenceEvent` is an immutable meaningful-change and user-action history. Its deterministic daily event key makes repeated pipeline runs idempotent.
- `WorklistItem.agencyProductIntelligenceId` links an accepted recommendation to execution without automatically creating tasks for every recommendation.

The existing wholesale `SalesOpportunity`, `OpportunityAccountSignal`, event, score, and purchase-event architecture remains unchanged and is reused when calculating linked wholesale influence.

## V1 retail fit factors

The transparent rule-based model uses:

- 30-day retail sales and observed sales history
- current and previous placement
- peer carry rate and peer 30-day velocity
- D8 tasting eligibility
- linked wholesale influence as a small supporting signal
- penalties for dead inventory and at-risk inventory status

Fit bands are High (65+), Medium (40–64), and Low (below 40). Rules and thresholds live in `lib/agencyIntelligenceConfig.ts`; every record stores `AGENCY_RULES_V1` and `AGENCY_RETAIL_FIT_V1`.

## Inventory and action states

- Stockout: zero on hand with at least two retail bottles sold in 30 days → Restock.
- Understocked: below configured minimum or under 14 estimated days of supply → Restock.
- Dead inventory: at least three on hand, no 30-day sales, and no sale for 45 days → Investigate.
- Missing placement: no current placement and High fit → Pursue placement.
- At risk: previously placed High-fit item disappeared or inventory status indicates removal/inactivity → Investigate.
- Healthy: inventory is present without an exception → Maintain/Winning according to fit.
- Insufficient data: no current placement and inadequate fit evidence → Monitor.

## Peer grouping

V1 groups Agencies deterministically by inventory district, falling back to county and then statewide. The current Agency is removed from its peer denominator and averages. Persisted peer facts include Agency count, carry percent, average 30-day retail sales, and average inventory.

## Tasting recommendation

A tasting is recommended only when the Agency is D8 eligible, at least two bottles are on hand, fit is at least 55, 30-day retail sales are four bottles or fewer, and no Agency visit has been recorded in 90 days. Zero/low inventory takes precedence, so the engine recommends restocking before tasting.

## Wholesale influence

The summary reuses linked `WholesaleAccount`, `AccountSalesEvent`, and open `SalesOpportunity` data. It reports linked/active accounts, current Echo buyers, Echo bottles in 30 days, lapsed buyers, and open wholesale opportunities. High and Medium bands use centralized buyer, volume, and opportunity thresholds; they are not averaged into the retail fit score.

## Daily pipeline and safety

The intelligence refresh runs after annual retail sales, wholesale sales, Agency inventory, and the existing wholesale opportunity engine. It verifies that all three OHLQ imports completed successfully for their exact report dates before writing. Current records and summaries use unique-key upserts. Change events use deterministic keys and `createMany(skipDuplicates: true)`.

Meaningful events include first detection, stockout, restock, below-minimum, dead-inventory threshold, missing placement, inventory-state changes, and opportunity-state changes. Signal snapshots and scoring versions preserve the foundation for later outcome analysis.

## Performance

Page requests read persisted summaries and product rows only. Daily computation loads each source in bounded batch queries, builds maps for joins, aggregates deterministic peer groups in memory, and avoids per-page calculations. Indexes cover Agency/item, date, inventory state, opportunity state, tasting flag, status, priority, and scoring versions.

## Manual QA checklist

Verify representative Agencies for healthy inventory, productive stockout, missing high-fit placement, dead inventory, weak fit with inventory, D8 activation, each retail/wholesale band combination, meaningful linked wholesale buyers, and recent visit history. On mobile verify the snapshot, top actions, collapsible product cards, current inventory, wholesale summary, dashboard links, and Agency Focus actions without horizontal scrolling.

## V1 assumptions and next steps

- Available product-specific retail behavior and deterministic peers are stronger V1 evidence than broad demographic assumptions.
- Logged Agency visits are the conservative proxy for recent activation; a future explicit tasting event type can sharpen the tasting window.
- Current raw sales retention limits the observed history used by V1. Longer persisted product outcomes will improve fit evaluation over time.
- Future work can add category-wide sales, independent/chain classification, tasting before/after windows, external store context, and calibrated outcome-based model versions without replacing the persisted signal architecture.
