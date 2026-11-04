# Reactivation Follow-up ownership

The existing 90-day purchase / 30-day lapse qualification and commercial/pursuit suppression gates are unchanged. New follow-ups use the most recent qualifying canonical `LoggedVisit` at that wholesale account, ordered by visit time (creation time and ID break ties). Its `createdByUserId` must identify an active, assignable member of the same organization. Future-dated visits, another tenant's visits/users, inactive users, Tasters and platform-only users do not qualify.

The Visit query uses canonical `LoggedVisit.locationType = 'wholesale'` (lowercase), matching Log Visit persistence. The existing retained `ohlqLastEchoPurchase*` qualification fields are Echo-specific, so candidate reads, sync and dashboard analysis fail closed for another organization. Assignment configuration/resolution is reusable per organization; this QOL change does not enable another tenant to receive follow-ups based on Echo's purchase state.

When no qualifying Visit exists, the automation reads `Organization.settings.defaultReactivationAssigneeUserId`. This is a stable user ID, validated against the same organization and membership rules each run. There is no name match or global James default. Another organization can set its own ID; missing or invalid configuration preserves the existing unassigned default.

TST configuration receipt, November 4, 2026: after the owner supplied and authorized James Clifford (`james@echospirits.com`), an active `USER` record was created in `org_echo_spirits` with stable ID `usr_james_clifford_tst_20261104`. Echo's `settings.defaultReactivationAssigneeUserId` is set to that ID in verified TST only. The organization/member/email relationship was read back in the configuration transaction. No password, invitation or email was created or sent. This ID is a TST record, not a portable production identifier; production promotion must resolve its own verified member ID.

This uses the existing JSON settings column: **no schema migration or backfill is required**. The guarded TST operator command previews the organization/member and only writes with `--apply`:

```powershell
npx tsx scripts/configure-reactivation-assignee.ts --env-file=<verified-tst-env> --organization=<stable-organization-id> --user-id=<verified-member-id> --actor-user-id=<organization-admin-id>
```

Run again with `--apply` after reviewing the target. `--clear` replaces `--user-id` to clear a fallback. The command requires `APP_ENV=test`, `DATABASE_TARGET_ID=neon-neat-tst`, the matching expected database host and an active organization administrator. It merges the one setting under the existing settings transaction lock and writes an organization audit event. It does not edit Worklist records.

During normal sync, existing active follow-ups retain valid owners. An encountered active follow-up with no valid owner can receive the same Visit/fallback assignment, using a conditional update so a concurrent ownership change or completion wins. Completed and cancelled historical follow-ups remain untouched. Existing item matching suppresses duplicate legacy records; new follow-ups also use the existing tenant-scoped unique `submissionKey`, based on account and latest qualifying purchase date, to prevent concurrent imports creating another item for the same lapse.

Removing the setting returns new unvisited-account follow-ups to unassigned behavior. Existing valid assignments and history remain unchanged. Production configuration is a separate release action; this command cannot write to production.
