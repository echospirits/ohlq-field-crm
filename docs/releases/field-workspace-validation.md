# Field workspace validation

Status: implemented, tested and deployed to TST as **0.5.0-dev**. Authenticated desktop and mobile acceptance is complete for the scoped presentation change. No production promotion is authorized by this task.

## Scope

Shared desktop navigation, account tabs and compact briefing, contextual mobile account actions, Worklist hierarchy/filter labels/relative urgency, a concise empty personal schedule with separate unassigned work, and visit form density/persistent actions. No migration or hosted configuration change.

## Evidence

- Clean `npm ci` succeeds against the inherited 0.4.0 dependencies and version-only 0.5.0-dev lockfile changes. Local runtime: Node 24/npm 11. GitHub's Node 22 clean-install job passes at `01e0a23ae6614418232953381999f36cb6da242a`: [run 40805105815](https://github.com/echospirits/neat-tst/actions/runs/40805105815), including `npm ci --ignore-scripts --no-audit --no-fund`. Subsequent commits leave package and lockfile contents unchanged; the path-filtered workflow does not run for UI-only changes.
- Full suite on the delivered application commit: **890 tests passed, zero failures**. Includes sparse/populated briefing, retained panel markup/default section, Eastern-day overdue age tests, linked-account search (legacy retail keys and scoped source-visit fallback), existing tenant/canonical-action coverage, concurrent performance/forecast coverage and the unchanged all-role Edit authorization expectation rendered through More actions.
- `npm run typecheck` passes on the delivered application commit. Local `npm run build` passes for the scoped UI/search changes with development environment and all six side-effect switches disabled, without live database credentials. The exact combined delivered TST commit also passes Vercel's build. An earlier local build collided with a test-held Windows Prisma DLL; the sequential retry passed.
- `git diff --check` passes. Impeccable mechanical detector ran once over changed UI files, returned `[]`, and exited 0. This does not establish WCAG conformance or browser behavior.
- React review: account panels remain mounted, role/feature selection stays server-owned, the client does not fetch protected account data, tab keyboard/hash history handlers clean up their listeners, and established canonical actions retain source/return context.

## TST delivery

- Initial interface commit: `01e0a23ae6614418232953381999f36cb6da242a`.
- Spacing correction: `e2d7b61e94bb8d878dceaaf9c1f6696671e1724e` (`Tighten mobile field workspace spacing and task actions`). Final application commit: `8eac246f98bae35c0a170a4d43addfcf2d1a9c94` (`Find Worklist tasks by linked account names`). Integrates independent navigation performance and forecast repair commits through `93a160dc7f3ce458a09164c08b80f12c8a1dd80b` without replacing their work.
- Exact-commit Vercel deployment `dpl_BnMqUHSnNYtEAahr2rwv1ryksMDf` is **READY**, assigned to `https://neat-tst.vercel.app`. The Vercel project is `neat-tst`; its platform target named `production` is the TST project's deployment target, not the Neat production application.
- After assignment, `/api/health` reports `ok=true`, `database=connected`, `environment=test`, `databaseTarget=neon-neat-tst`.
- Production `origin/main` remains `f7f5d8012751f79875e3f6d0999dc28ad02cb926` (0.4.0). No production push, tag, migration, hosted configuration change or provider operation was performed. A documentation-only follow-up records this evidence.

## Authenticated browser acceptance

Chrome reused the owner's existing session. No temporary admin session was created and no CRM form was saved. Checked actual TST pages at **390 × 844** and **1440 × 900**.

- Restaurant account (Cincinnati Zoo) and retail account (Arena Wine & Spirits) use the shared account tabs, with account-specific available sections. Purchases, retail Sales, Intelligence and Details render their existing content. No document overflow was observed.
- Arrow keys, Home and End select/focus the expected tabs; browser Back restores the prior section. A contact fragment opens its editor. An unsaved note survives switching to Purchases and back; the test text was cleared without saving.
- More actions retains Follow-up, Target, Create order and authorized Edit. Follow-up opens with the account and owner prefilled; Escape closes it. Contextual visit entry retains account/source/return destination. Selecting Phone changes the action to Save interaction; Cancel returns to the account. Generic visit entry disables Save until an account is selected and explains why.
- Mobile account status is 64px high after correction. Worklist rows are about 180px rather than 348px in the first pass; the first task actions are visible above navigation. Search and Filters share a compact row, and filter controls have associated labels. My work correctly shows an empty state while team work contains two unassigned tasks.
- The final functional search check found that the existing query ignored account names. The scoped follow-up now returns Cincinnati Zoo when searching Cincinnati, then restores both team tasks when cleared. Expanded task editing fits at desktop and phone sizes without horizontal overflow. No console errors were recorded in the final check.
- Empty personal schedules show no empty time grid, distinguish unassigned team work, and open the existing scheduling dialog. The dialog closes without creating work. Mobile visit Save/Cancel remain above bottom navigation.
- Loading, empty and disabled states were observed live. Existing regression coverage checks canonical actions and feedback; successful/error writes, populated calendars, every role/entitlement combination, theme preferences and live provider operations were not exercised by changing shared TST data. These are not claims of end-to-end provider acceptance or complete WCAG conformance.

Screenshots are saved in the task's `neat-ui-audit/implementation` artifact folder: desktop and mobile account, Worklist, schedule and visit images, plus retail desktop. Visual verification used one initial batch, one correction batch and one final confirmation batch. The subsequent search fix received a focused functional check; it does not change those layouts. Full-page screenshot capture timed out in the browser bridge, so the verified viewport captures are the review artifacts. No additional cosmetic iteration is pending.
