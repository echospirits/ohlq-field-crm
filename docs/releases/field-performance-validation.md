# Neat field workflow performance

## Live baseline

| Environment | Git source | Vercel project and region | Neon database and region |
| --- | --- | --- | --- |
| Production | `echospirits/ohlq-field-crm` `main` at `48a7b504` | `ohlq-field-crm`, `iad1` | `ohlq-field-crm`, AWS `us-east-1` |
| Shared TST | `echospirits/neat-tst` `tst` at `f7f1c5d1` | `neat-tst`, `iad1` | `neon-neat-tst`, AWS `us-east-1` |

Both canonical deployments reported READY and connected with their expected environment and database target. The audit targets the Sales role. Production investigation is read-only and all visit writes belong to the test rehearsal.

During the audit, TST advanced through `796d0414` (Echo state access) and `ab80c97f` (Restaurant Opportunities product eligibility). The before-and-after comparison uses the earlier `f7f1c5d1` policy in both builds. The latest TST integration preserves both independent changes. The selective production candidate uses its `main` baseline policy.

## Diagnosed waits

- Log Visit eagerly read both account directories up to 750 rows each, joined visit recency for each list, and passed up to 1,000 active tenant contacts into the form. Prefilled links took that same path and sometimes ran an additional account lookup. The startup form now uses bounded suggestions or its selected account, and requests contact options for that account only.
- Search had a fixed 250 ms pause before pending feedback or a lookup. Wholesale name results could fall outside the alphabetical candidate limit even when they matched the query more closely. The picker now gives immediate feedback and the lookup prioritizes stronger matches.
- Confirmation read the saved visit and then blocked on the related-work prompt. My Schedule blocked its personal work on organization summaries. Secondary content now renders behind separate boundaries. History reads a smaller projection and starts photo requests when a gallery opens.
- The measured baseline resolves enabled states and builds the state-scope reference set on protected account requests. The independent TST access change bypasses those broad reads for active Echo Sales requests. Production and TST lack `pg_stat_statements`. Vercel and Neon regions match.
- At 390 × 844, Log Visit required two navigation taps from My Schedule (**More**, then **Log Visit**). The mobile schedule header now links directly to Log Visit. Account-origin entry still carries the selected account.
- The audit also exercised account lists, global account search and Worklist. The Worklist create flow still preloads large lookup lists. Some computed wholesale directory sorts decorate up to 25,000 records. Changes here would need their own workload measurements and workflow coverage.

## Database observations

Production planner estimates were about 16,285 wholesale accounts, 608 retail accounts, 18,045 wholesale license IDs and 196 logged visits. TST had about 16,005, 610, 16,034 and 3 respectively before synthetic fixtures. Read-only picker-shaped SQL scans for a public wholesale substring with a 50-row cap took 16.7–19.0 ms on production and 39.5–120.7 ms on TST. Retail substring scans took 0.6 ms and 6.7 ms, respectively. These timings measure execution on each database. The isolated Windows app's pooled Prisma `SELECT 1` took 1,004 ms including first connection and 53–101 ms warm.

Two isolated startup plan samples returned 750 wholesale rows for the old query and five for the fallback. Their SQL execution times were 8.0–73.2 ms and 6.7–6.8 ms. Recent-visit grouping took 0.1–1.7 ms and returned up to five keys per type. The corresponding contact queries returned 127 tenant contacts and one selected-account contact, at 0.2–3.9 ms and 0.1–1.4 ms SQL execution. The smaller contact query used the composite index. These are individual query shapes with warm and cold cache effects. The browser payload and interaction timings capture the impact of transferring and consuming those results.

The observed database execution times do not account for the multi-second field waits. Browser throttling, network round trips, repeated authorization and state scope, server preparation and rendering all contribute to the end-to-end time. Retained production logs did not show enough visits to characterize cold starts or correlate job overlap. Existing scheduled imports and providers were not invoked for the investigation. The audit found no measured case for replacing a stack component.

## Browser measurements

Chrome used the optimized baseline and candidate (`f7f1c5d1` and `1338ffec` source trees), a synthetic Sales user, and a verified isolated Neon child of TST. Mobile settings were 390 × 844, 4× CPU slowdown, 150 ms latency, 1.6 Mbps download and 0.75 Mbps upload. The following are individual runs. Cold browser tests use a fresh cache and can encounter different server or database cache conditions. These samples do not estimate production percentiles.

| Workflow | Baseline | Candidate |
| --- | ---: | ---: |
| Cold direct Log Visit to restaurant selected | 26.434 s | 12.900 s |
| Warm repeat to restaurant selected | 8.082 s | 6.944 s |
| Cold restaurant form document / JavaScript | 69 / 178 KiB | 10 / 164 KiB |
| Cold direct restaurant to input accepted | 20.783 s | 8.956 s |
| Cold direct restaurant search after input accepted, to visible results | 4.038 s | 2.727 s |
| Warm direct restaurant to input accepted | 4.424 s | 4.057 s |
| Warm direct restaurant search after input accepted, to visible results | 2.893 s | 2.375 s |
| Cold direct restaurant Save to confirmation | 7.377 s | 6.495 s |
| Direct retail entry to account selected | 9.872 s | 7.267 s |
| Retail account link to prefilled form | 4.531 s | 3.439 s |
| Retail account origin Save to confirmation | 7.470 s | 5.907 s |
| Restaurant account link to prefilled form | 8.052 s | 3.333 s |
| Restaurant account origin Save to confirmation | 7.095 s | 5.211 s |
| App open from cold browser cache to selected restaurant | 14.398 s | 15.372 s |
| Navigation taps from My Schedule to Log Visit | 2 | 1 |
| My Day load | 5.783 s | 5.017 s |
| My Week load | 6.161 s | 3.577 s |
| Populated Visit History, cold browser | 8.425 s (196 rows) | 7.622 s (201 rows) |
| Worklist | 4.274 s | 4.943 s |

Input acceptance and result timing use the same fill-completion boundary in both builds. The initial baseline direct runs preceded the addition of synthetic history for the populated history comparison. First response byte moved from 3.155 s to 0.949 s in the cold direct run. Its database transaction committed 2.767 s into the server action (from 3.124 s), and the server recorded confirmation handoff at 2.772 s (from 3.464 s). The browser reached confirmation after 6.495 s. The sampled candidate server search took 2.340 s end to end, with authentication at 0.233 s. That includes awaited application and database work beyond the standalone SQL execution.

The direct route and both account-origin routes passed retail and restaurant persistence checks. Fast double taps sent one POST per tested visit. Losing a response after the database commit preserved entered notes, and retry confirmed the same single row. The synthetic contacts check excluded inactive and other-tenant contacts and denied signed-out access. Search recovered after an injected 503 on the same text. Mobile at 390 × 530 reproduced reduced keyboard space without horizontal scrolling. At 1440 × 900 the desktop picker was usable and the mobile-only shortcut remained hidden. Headless tab switching preserved input, but the page never reported hidden. Physical Android lifecycle, keyboard and touch behavior remain unverified.

The initial A/B build exposed a 403 on sampled timing delivery when Next normalized the routing host. The integration uses browser Fetch Metadata for same-origin validation and retains the strict payload limit, authentication and cross-origin rejection. Successful search and save retries are classified as `retry`.

## Timing records

Open Runtime Logs in the matching Vercel project. Search for `visit.timing.browser` to find sampled form, account search, and save completion events. `elapsedMs` is measured to painted feedback or results and `responseMs`, when present, is time until initial feedback. The form reports whether its source timing is a document load or a route resource. Prefetch and cache reuse affect the meaning of route resource measurements. Use separate cold and repeat browser runs for release comparisons.

Match the opaque `id` to `visit.timing.server` for form and search. Subtract `authenticated` from `loaded` to estimate the time spent awaiting post-authentication reads and picker preparation. Match a save `id` to `browserTimingId` in the existing `visit.stage` or `visit.failed` logs. The `transaction` and `committed` timestamps bracket the database transaction and its application work. Compare those times with the browser completion to locate waits before or after persistence. Save replay emits the `duplicate_submission` stage.

New browser instrumentation samples one in 32 interactions. The log endpoint accepts a small, fixed schema from authenticated same-origin requests. Timing records include only the opaque ID and bounded timings, outcomes and phase names. The endpoint stores no application rows. Search terms, locations, notes, and contact data are excluded. Successful confirmation consumes its matching browser attempt once.
