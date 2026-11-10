# Production Forecasting warehouse comparison

Primary task: compare GPT/GRN immediate case demand with Quantity + Picked stock, identify signed shortfalls and open product detail from My Schedule. The owner specified GPT | GRN pairs in the existing tool. This scoped refinement preserves Neat's design, navigation and canonical product detail.

Working facts stay visible: product/code, warehouse, demand, inventory, balance, source business date and material stale/missing exceptions. Retrieval/method/history are supporting depth. No automated transfer decision/action is introduced.

Desktop grows from eight to ten columns. Mobile groups three operational pairs below identity and keeps forecast facts lower in each record. My Schedule shows all current negative pairs to entitled Admin/Sales users. Reading costs zero interactions; schedule→detail→schedule costs two activations, preserving day/week/date through horizon changes. Supporting source-method depth takes one disclosure opening.

One initial browser inspection and one correction/confirmation batch cover actual hydrated table search and SSR widget/detail at 390 × 844, 1440 × 900 and 320px dark mode. Exact prior TST source/CSS at `9b30b2bd` and identical synthetic cases provide matched before views. A correction fixes native-table containment, true source dates and four-place operational stock precision. Width checks pass; signed negative values use theme danger colors and accessible warehouse labels. Long names, zero, asymmetric/stale/missing data, loading/error/empty and TASTER restriction are covered. No findings from the mechanical detector; React/backend reviews are clear.

Density tradeoff: desktop has two complete first-viewport records versus four before; mobile's three warehouse comparisons are visible, while completing the first record now requires vertical scrolling (one fitted before). All facts remain in the main view. All-shortfall rows move the schedule down, as requested. No extra menu or search is required.

Ignored screenshots are retained under `output/warehouse-balance/ui/`: desktop-before/after, mobile-before/after, schedule-desktop-after, schedule-mobile-after, narrow-dark-after, schedule-loading and schedule-error. Fixtures use no live records/providers and prove component behavior only. See [validation](../../docs/releases/0.8.0-validation.md) for separate database/source and live TST receipts. Human review remains pending.
