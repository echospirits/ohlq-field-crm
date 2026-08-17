# Weekly account research

The CRM uses a reviewed CSV handoff so public research can be completed with a ChatGPT subscription rather than the OpenAI API.

## Weekly workflow

1. An administrator opens **Administration → Account Research**.
2. Download the next 25 due accounts. Accounts being pursued are prioritized, followed by open opportunities and target rank. Research becomes due again after seven days.
3. Attach the CSV to a normal ChatGPT conversation and use the prompt shown on the page.
4. Download ChatGPT's completed CSV without editing the identity columns.
5. Upload it to the same page and run **Validate only**.
6. If validation passes, re-upload the same file and choose **Import research**.

The import is all-or-nothing. It verifies the CRM account ID, account name, Licensee ID, enums, ratings, dates, URLs, duplicate rows, notes, and citations. A successful import upserts one public-research record per account and immediately recalculates affected opportunity scores. Existing pursued opportunities are updated rather than duplicated.

## CSV conventions

- Do not edit `wholesale_account_id`, `licensee_id`, `account_name`, `address`, `city`, `state`, or `zip`.
- Separate multiple local brands and source URLs with `|`.
- Use `YYYY-MM-DD` for `researched_at`.
- Every row needs concise notes and at least one public source URL.
- Unknown facts must be blank or use the allowed `Unknown`/`Unclear` value; they must not be guessed.

The CRM intentionally does not use an OpenAI API key or a Vercel research cron for this workflow.
