# Visit save reliability

On September 14, 2026, the production `/visits/new` POST starting at
21:25:31 UTC returned 500 because Vercel killed the instance for exhausting
memory. James Clifford's Yellow Springs Brewery visit was persisted at
21:25:32 UTC. The deployed save action ran full opportunity intelligence after
the transaction and before confirmation; its statewide history query covered
433,467 rows even though only one account was requested.

Visit create and update actions no longer call the statewide opportunity
engine. Full recalculation remains in `runOpportunityIntelligenceAfterImport`
through the existing OHLQ annual-sales import workflow. Consequently, automatic
opportunity scores and visit-based resolution refresh on the next successful
import, rather than during submission. Explicit resolution choices on the visit
confirmation page remain available.

Calendar synchronization is best effort after the visit transaction. A lookup
or synchronization exception is logged without turning a saved visit into an
unsuccessful submission. Existing calendar synchronization error handling and
photo success/partial-failure behavior remain in place.

## Investigating an incident

Search Vercel runtime logs for `visit.stage`, `visit.failed`, or
`visit.follow_up_failed`, within the reported time range. Use `operationId` to
group one submission; use `userId`, `organizationId`, and `visitId` to correlate
it with the database. Records include stage, timestamp, elapsed milliseconds,
process RSS, used heap, and deployment/revision when provided by Vercel.

`committed: true` means the visit transaction finished. Photos and follow-up
work may still be pending; Taster photo failures retain the existing compensating
visit deletion. `duplicate_submission` means the existing submission key was
recognized and the action returned the already-saved visit.

Expected Next.js redirects are rethrown without being classified as errors.
Unexpected exceptions retain stack frames and Prisma error codes without copying
form values or raw error messages into these diagnostic records. A process kill
cannot be caught by JavaScript: use the last stage record together with Vercel's
platform error and check the saved visit before retrying. Runtime log retention
still depends on the hosting plan.
