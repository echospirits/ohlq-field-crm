# Account Research waterfall

Account Research has two paths: a guarded automated pilot in the dedicated test environment and the existing reviewed CSV fallback.

## Guarded 50-account pilot

The pilot is intentionally constrained:

- It is available only when `APP_ENV=test`, the branch is `tst`, `ACCOUNT_RESEARCH_PILOT_ENABLED=true`, and a test-environment `OPENAI_API_KEY` is configured.
- Production rejects every submit, poll, approve, and reject operation even if the feature flag is set accidentally.
- An administrator must start it manually. There is no cron or scheduled research route.
- It selects at most 50 due accounts with complete street, city, and ZIP identity from the current tenant's opportunities; incomplete locations stay in the manual CSV queue.
- Each account reserves $0.40 before submission, so the pilot can never reserve more than the $20 application ceiling.
- Fatal authorization, quota, or rate-limit errors pause submission and leave unsent accounts queued.
- Each account is a separate background Responses API job using `gpt-5.6-luna`, at most three web-search tool calls, and at most 2,500 output tokens.
- Retrieved usage records input tokens, output tokens, web-search calls, and an estimated per-account cost. The OpenAI project budget remains the final billing backstop because application estimates are not invoices.

The waterfall assigns pursued accounts and provisional scores of 70 or more to the deep tier. Other due opportunities receive a lightweight identity and public-fit pass. This pilot measures the quality and cost of both tiers before broader automation is considered.

## Evidence and exact-location review

The model must return strict structured JSON with field-level claims, source URLs, and an explicit exact-location marker. The server independently requires:

1. An `EXACT` identity verdict.
2. The same street number.
3. The same city.
4. The same five-digit ZIP.
5. At least one source explicitly supporting that location.

Every completed result enters the manual review queue. Nothing is automatically imported. Results that fail exact-location validation cannot be approved. Approval upserts the account's shared public facts and immediately recalculates that tenant's affected opportunity; rejection records a required reason and changes no account or opportunity data.

## Manual CSV fallback

1. Open **Administration → Account Research**.
2. Download the next 100 or 200 due accounts. Pursued accounts refresh after 30 days and other tracked opportunities after 90 days.
3. Research the file using the disclosed prompt or another reviewed source.
4. Upload it and choose **Validate only**.
5. If validation passes, upload the same file and choose **Import research**.

The import remains all-or-nothing. It verifies CRM account ID, account name, Licensee ID, enums, ratings, dates, URLs, duplicates, notes, and citations. Successful imports update `lastRefreshedAt`, move accounts behind older work, and recalculate affected opportunities.
