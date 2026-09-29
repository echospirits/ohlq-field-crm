# Out-of-state wholesale prospects

Create an account from Wholesale or Log Visit with its name, street address, city, state and ZIP. State accepts a US abbreviation or full name and is stored as a two-letter code. Ohio remains the default. Licensee IDs are optional on creation; a generated internal ID is used when omitted. Non-Ohio permit numbers are state-prefixed to avoid collisions with OHLQ imports. Existing missing states are audited/backfilled as Ohio without overwriting other states.

## Research eligibility

Complete out-of-state locations do not require Ohio sales or an existing opportunity to enter the automatic or manual-export research queues. Existing freshness, identity-change, failure cooldown, spending and daily limits still apply. Production scheduling is unchanged; test remains manual. Location validation requires the correct state as well as the street number, city and ZIP. Local menu evidence means local to the account's state, not automatically Ohio.

## Two distinct score bases

Ohio accounts use sales-backed V6 scoring. Out-of-state accounts use `RESEARCH_FIT_V2`, a provisional discovery score, only after current-location research exists. The research-only model gives the greatest weight to evidence-backed foot traffic and verified review volume, adds patio, private-dining, and hotel meeting-space signals, and gives star ratings at most two points. Hotel meeting space contributes only when the account is a bar or restaurant inside that exact hotel property. The active eligible tenant portfolio provides category context; it is not proof of distribution in another state. No sales volume, bottle-price affinity, displacement target or buying conversion is inferred from missing sales data.

Research-only contributions: public fit up to 60 (cocktails, popularity, ratings/review volume and patio); named local menu brands 10; exact-location menu category overlap with the tenant portfolio 20; confirmed independent buying 10. No baseline points. National chains receive a 25-point penalty and 20-point cap. Incomplete confidence/operating status caps scores; closed locations or missing current-location research score zero. Recommendations are buyer/price/distribution qualification, not a specific product pitch.

Research-only scores are explicitly labeled and should be compared with other research-only prospects, not treated as equivalent to V5. State filtering is available in Opportunities; the territory view remains explicitly Ohio-only. Tenant-specific scoring and workflow status handling remain in place. Existing historical detection snapshots are not rewritten. Learning from sales outcomes remains available where sales evidence exists, not fabricated for other states.

## State backfill

`npx tsx scripts/backfill-wholesale-states.ts --env-file=<ignored-env-file> --environment=test`

Audits by default. Add `--apply` to fill missing states and normalize `Ohio` to `OH`; production additionally requires `--confirm-production` and `--environment=production`. No schema migration is needed: `WholesaleAccount.state` already exists.
