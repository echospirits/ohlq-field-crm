import { rowMatchesWholesaleImportIdentity, type AccountMasterRow } from './ohlqAccountMasterImport';

type Identity = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

// Existing exact ownership survives address corrections. Address/name evidence
// can resolve new IDs, but must not move a known ID between unmerged accounts.
export function resolveAccountMasterWholesaleOwner<T extends Identity>({
  row, exact, candidates, sourceKeyIsUnique,
}: {
  row: AccountMasterRow;
  exact: T | undefined;
  candidates: T[];
  sourceKeyIsUnique: boolean;
}): T | null {
  if (exact) return exact;
  const strongMatches = candidates.filter(account => rowMatchesWholesaleImportIdentity(row, account));
  if (strongMatches.length === 1) return strongMatches[0];
  return sourceKeyIsUnique && candidates.length === 1 ? candidates[0] : null;
}

export function getAccountMasterAliasTransfers<T extends { id: string }>(
  plans: Array<{ rows: AccountMasterRow[]; account: T | null }>,
  existingOwners: ReadonlyMap<string, T>,
) {
  return plans.flatMap(plan => plan.rows.flatMap(row => {
    const existing = existingOwners.get(row.licenseeId.trim().toUpperCase());
    return existing && existing.id !== plan.account?.id
      ? [{ licenseeId: row.licenseeId, fromAccountId: existing.id, toAccountId: plan.account?.id ?? null }]
      : [];
  }));
}

// A shared source location is not an authorization to merge existing accounts.
// Unowned IDs stay together for the normal evidence-based resolver.
export function partitionAccountMasterLocationByOwner<T extends { id: string }>(
  rows: AccountMasterRow[], existingOwners: ReadonlyMap<string, T>,
) {
  const groups = new Map<string | null, AccountMasterRow[]>();
  for (const row of rows) {
    const owner = existingOwners.get(row.licenseeId.trim().toUpperCase())?.id ?? null;
    groups.set(owner, [...(groups.get(owner) ?? []), row]);
  }
  const knownOwners = [...groups.keys()].filter(owner => owner !== null);
  return knownOwners.length > 1 ? [...groups.values()] : [rows];
}

export function accountMasterRowsBelongToOwner<T extends { id: string }>(
  rows: AccountMasterRow[], accountId: string, existingOwners: ReadonlyMap<string, T>,
) {
  return rows.length > 0 && rows.every(row => existingOwners.get(row.licenseeId.trim().toUpperCase())?.id === accountId);
}

export function getAccountMasterOwnershipConflicts(
  accounts: Array<{
    id: string;
    licenseeId: string;
    officialAccountId: string | null;
    licenseeIds: Array<{ licenseeId: string }>;
  }>,
  officialLicenseeIds: ReadonlyMap<string, string>,
) {
  const owners = new Map<string, Set<string>>();
  for (const account of accounts) {
    const ids = [account.licenseeId, ...account.licenseeIds.map(alias => alias.licenseeId),
      account.officialAccountId ? officialLicenseeIds.get(account.officialAccountId) : null];
    for (const id of ids) {
      const key = id?.trim().toUpperCase();
      if (!key) continue;
      const matches = owners.get(key) ?? new Set<string>();
      matches.add(account.id);
      owners.set(key, matches);
    }
  }
  return [...owners].filter(([, ids]) => ids.size > 1)
    .map(([licenseeId, ids]) => ({ licenseeId, accountIds: [...ids].sort() }))
    .sort((left, right) => left.licenseeId.localeCompare(right.licenseeId));
}
