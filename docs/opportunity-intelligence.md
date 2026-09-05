# Tenant opportunity intelligence V3

## Product-specific fit

Opportunities are scored for an individual active OWNED or REPRESENTED organization product. Discontinued products and products with strategicPriority zero are excluded from new prospect recommendations. All owned products, including Capital City within Echo's tenant, remain eligible by default. Category, item identity and price come from the shared OHLQ catalog; purchasing, contacts, suppression, assignment, opportunities and outcome models are organization scoped.

Prices are current OHLQ retail prices normalized to 750ml. `productVolume` is US fluid ounces (25.4 = 750ml, 33.8 = 1L, 59.2 = 1.75L), not liters. These prices are a market-position proxy, not historical invoice prices.

Price fit contributes up to 35 points: same-category volume share in a comparable price band (75–175% of the target price), plus actual comparable purchasing volume saturating at 24 equivalent bottles. Missing prices reduce the contribution. A mostly inexpensive account can still have a meaningful premium niche.

When price coverage is at least 70%, at least 12 equivalent bottles were observed, 80% or more is below 60% of the target's price, and fewer than six comparable bottles were purchased, the acquisition score is capped at 30. Existing-customer follow-up opportunities are not subject to that acquisition cap.

Verified Ohio-brand purchasing adds at most two general preference points. Up to eight additional points require Ohio-brand purchases in the target category at comparable prices. No aggregate Ohio-liter or workbook-affinity bonus can make budget vodka look like premium rum affinity. The initial conservative registry covers Echo Spirits, Noble Cut, Buckeye Vodka and Capital City. Unlisted brands have unknown local status; extend it with verified brand identities, not distributor-wide assumptions.

Other components: base 10, category demand up to 15, public research up to 15, tenant relationship up to 10, contact urgency up to 5, buyer comparison up to 5, workload deduction up to 5, and validated outcome adjustment bounded to ±10. National-chain priorities retain the 20-point cap. Scores are prioritization points, not probabilities.

Catalog category takes precedence over name matching; Rumple Minze is a cordial. Whiskey names use whole-word subtype recognition. Missing subtype information is not invented. Historical workbook price fits and private target scores no longer supply the price component.

## Existing buyers

For each product, compare same-category, non-tenant-product baskets at accounts buying at least two bottles of that particular product. One account gets one vote; exclude the account being scored. Capital City customers are not the evidence for premium Echo bourbon. Ten comparable independent buyer accounts are required before this contributes up to five points. This is descriptive similarity, not causality.

## Daily source and retained history

The downloader sets From date and To date to the same day. Despite the report's “Annual Sales” name, rows represent daily sales. V1/V2 incorrectly subtracted consecutive rows. V3 records daily quantities directly with deterministic `DAILY_V3:` keys scoped to organization, account, permit, date, agency, vendor and item. Ambiguous license mappings are skipped.

Evaluation reconstructs retained reports and prefers them over ledger copies. It fills missing V3 ledger rows before retention so future evaluations retain up to 90 days of verified daily history. Legacy events are preserved but excluded from V3 scoring and training. Already-pruned raw data cannot be reconstructed from incorrect delta records. Explanations disclose the earliest observation date; partial windows are not full histories.

A first-ever purchase is never inferred from a short retained window. `historyComplete` requires explicit verified history. Product membership is resolved from the organization at evaluation time; legacy Echo classifications do not leak into another customer's scores.

## Learning and outcomes

The old engine refreshed signals and recorded outcomes, but did not learn weights. V3 adds a bounded outcome-learning component. Rule/price scoring works without a trained model.

Detection stores immutable features including product prices, research, peer evidence and pre-detection CRM contact activity. The DETECTED event stores its original hypothesis and signal version. Daily updates refresh current signals, explanations and scores without overwriting detection features. V2 snapshots are not relabeled as trustworthy V3 examples.

Learning waits for complete 90-day windows after V3 detection. Missing successful report days censor the example instead of labeling a failed sale. The outcome is a purchase of the original target item, independent of dismissal/pursuit/closure status. Features include opportunity type, category, price alignment, comparable Ohio-brand purchasing and prior CRM contact. Activity associations do not establish causation.

Each tenant trains independently. Only the earliest eligible example per account is used, with a chronological 80/20 split and no account overlap. Segment rates require ten training accounts and shrink toward the tenant baseline with 20 prior observations. Activation requires 80 training accounts, 20 validation accounts, ten training conversions and nonconversions, five validation conversions and nonconversions, and greater-than-5% improvement in Brier error over the baseline. Until then the learner contributes zero; after validation, at most ±10 points.

Product configuration and learned models are recorded in tenant-named `OpportunityModelVersion` entries. Administration → Opportunity Performance reports whether learning is collecting evidence or influencing scores. This initial learner uses interpretable segments; richer interaction/outcome models can replace it through the ranker interface after historical validation.

## Lifecycle and validation

One active opportunity per tenant/account remains the invariant. Pursued records retain identity and task links. V3 product recommendations stay anchored to the original product while scores refresh. Product-specific conversions require that item, not an unrelated inexpensive product from the tenant. Legacy recommendations can transition to specific products without converting their old snapshots into training examples.

Tests cover categories, sizes, cheap/local versus comparable/local purchasing, premium niches, missing prices, tenant fit, buyer self-exclusion, consecutive daily purchases, ambiguous identities, mature outcomes and independent validation. `scripts/audit-opportunity-affinity.ts --score` runs the evaluator with `dryRun: true` inside a database-enforced read-only transaction.

No schema migration is required. Publish before recalculating production scores. The first V3 run backfills only retained reports into the new ledger; it does not erase historical records or fabricate missing history.
