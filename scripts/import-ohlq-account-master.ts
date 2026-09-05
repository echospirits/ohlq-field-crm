import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AccountType, Prisma, PrismaClient } from '@prisma/client';
import { assertSideEffectEnabled, validateRuntimeEnvironment, logEnvironmentEvent } from '../lib/appEnvironment';
import {
  assertAccountMasterSelectionIsSafe,
  choosePrimaryAccountMasterRow,
  getImportedWholesaleName,
  groupAccountMasterRowsByLocation,
  parseAccountMasterCsv,
  rowMatchesWholesaleImportIdentity,
  type AccountMasterRow,
  type ExistingAccountIdentity,
} from '../lib/ohlqAccountMasterImport';
import { getGeocodeResetForAddressChange } from '../lib/location/geocode';
import { areOhlqAddressesSame, getOhlqLicenseeMatchKeys } from '../lib/ohlqWholesaleMatching';
import { getWholesaleLicenseeIdValues } from '../lib/wholesaleAccounts';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const fileArgIndex = process.argv.indexOf('--file');
const environmentArgIndex = process.argv.indexOf('--environment');
const explainArgIndex = process.argv.indexOf('--explain-licensee');
const sourcePath = fileArgIndex >= 0 ? path.resolve(process.argv[fileArgIndex + 1] ?? '') : '';
const expectedEnvironment = environmentArgIndex >= 0 ? process.argv[environmentArgIndex + 1] : '';
const explainLicenseeId = explainArgIndex >= 0 ? (process.argv[explainArgIndex + 1] ?? '').trim().toUpperCase() : '';
const getNonNegativeIntegerEnv = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
};
const maximumNewLocations = getNonNegativeIntegerEnv('OHLQ_ACCOUNT_MASTER_MAX_NEW_LOCATIONS', 250);
const maximumDeactivations = getNonNegativeIntegerEnv('OHLQ_ACCOUNT_MASTER_MAX_DEACTIVATIONS', 500);

const identity = (account: {
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  agencyId?: string | null;
  agencyRefId?: string | null;
}): ExistingAccountIdentity => ({
  name: account.name,
  address: account.address,
  city: account.city,
  zip: account.zip,
  agencyId: account.agencyId ?? account.agencyRefId ?? null,
});

const values = (row: AccountMasterRow) => ({
  address: row.address,
  agencyId: row.agencyId,
  city: row.city,
  county: row.county,
  deliveryDay: row.deliveryDay,
  districtId: row.districtId,
  ownership: row.ownership,
  phone: row.phone,
  state: row.state,
  zip: row.zip,
});

async function main() {
  if (!sourcePath || !existsSync(sourcePath)) throw new Error('Pass an existing Account Master CSV with --file <path>.');
  if (!['test', 'production'].includes(expectedEnvironment)) {
    throw new Error('Pass --environment test or --environment production.');
  }

  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== expectedEnvironment) {
    throw new Error(`Requested ${expectedEnvironment}, but APP_ENV=${runtime.appEnvironment}.`);
  }

  const source = readFileSync(sourcePath, 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const [officialAccounts, wholesaleAccounts] = await Promise.all([
    prisma.account.findMany({
      where: { licenseeId: { not: null } },
      select: { id: true, type: true, licenseeId: true, name: true, address: true, city: true, zip: true, agencyRefId: true },
    }),
    prisma.wholesaleAccount.findMany({
      where: { mergedIntoId: null },
      include: { licenseeIds: { select: { licenseeId: true } } },
    }),
  ]);
  const namesToPreserve = new Map(
    wholesaleAccounts.filter((account) => account.isActive).map((account) => [account.id, account.name]),
  );

  const identitiesByLicenseeId = new Map<string, ExistingAccountIdentity[]>();
  const appendIdentity = (licenseeId: string, item: ExistingAccountIdentity) => {
    const key = licenseeId.trim().toUpperCase();
    identitiesByLicenseeId.set(key, [...(identitiesByLicenseeId.get(key) ?? []), item]);
  };
  officialAccounts.forEach((account) => account.licenseeId && appendIdentity(account.licenseeId, identity(account)));
  wholesaleAccounts.forEach((account) =>
    getWholesaleLicenseeIdValues(account).forEach((licenseeId) => appendIdentity(licenseeId, identity(account))),
  );

  const selection = parseAccountMasterCsv(source, identitiesByLicenseeId);
  assertAccountMasterSelectionIsSafe(selection, {
    minimumSelectedRows: getNonNegativeIntegerEnv('OHLQ_ACCOUNT_MASTER_MIN_SELECTED_ROWS', 10_000),
  });
  const officialByLicenseeId = new Map(
    officialAccounts
      .filter((account) => account.licenseeId)
      .map((account) => [account.licenseeId!.trim().toUpperCase(), account]),
  );
  const officialLicenseeIdById = new Map(
    officialAccounts.filter((account) => account.licenseeId).map((account) => [account.id, account.licenseeId!]),
  );
  const wholesaleByLicenseeId = new Map<string, typeof wholesaleAccounts[number]>();
  const wholesaleByMatchKey = new Map<string, Map<string, typeof wholesaleAccounts[number]>>();
  const conflictingWholesaleIds = new Set<string>();
  wholesaleAccounts.forEach((account) => {
    const officialLicenseeId = account.officialAccountId
      ? officialLicenseeIdById.get(account.officialAccountId)
      : null;
    const knownLicenseeIds = Array.from(new Set([
      ...getWholesaleLicenseeIdValues(account),
      ...(officialLicenseeId ? [officialLicenseeId] : []),
    ]));
    knownLicenseeIds.forEach((licenseeId) => {
      const key = licenseeId.trim().toUpperCase();
      const existing = wholesaleByLicenseeId.get(key);
      if (existing && existing.id !== account.id) conflictingWholesaleIds.add(key);
      else wholesaleByLicenseeId.set(key, account);
      getOhlqLicenseeMatchKeys(licenseeId).forEach((matchKey) => {
        const candidates = wholesaleByMatchKey.get(matchKey) ?? new Map();
        candidates.set(account.id, account);
        wholesaleByMatchKey.set(matchKey, candidates);
      });
    });
  });

  const sourceRowsByMatchKey = new Map<string, Set<string>>();
  selection.selected.forEach((row) => getOhlqLicenseeMatchKeys(row.licenseeId).forEach((matchKey) => {
    const ids = sourceRowsByMatchKey.get(matchKey) ?? new Set();
    ids.add(row.licenseeId);
    sourceRowsByMatchKey.set(matchKey, ids);
  }));
  const resolvedWholesaleByLicenseeId = new Map<string, typeof wholesaleAccounts[number]>();
  selection.selected.forEach((row) => {
    const exact = wholesaleByLicenseeId.get(row.licenseeId);
    if (exact && rowMatchesWholesaleImportIdentity(row, exact)) {
      resolvedWholesaleByLicenseeId.set(row.licenseeId, exact);
      return;
    }
    const candidates = new Map<string, typeof wholesaleAccounts[number]>();
    getOhlqLicenseeMatchKeys(row.licenseeId).forEach((matchKey) =>
      wholesaleByMatchKey.get(matchKey)?.forEach((account) => candidates.set(account.id, account)),
    );
    const strongMatches = Array.from(candidates.values()).filter((account) => rowMatchesWholesaleImportIdentity(row, account));
    const sourceKeyIsUnique = getOhlqLicenseeMatchKeys(row.licenseeId).some(
      (matchKey) => sourceRowsByMatchKey.get(matchKey)?.size === 1,
    );
    const resolved = strongMatches.length === 1
      ? strongMatches[0]
      : exact
        ? exact
      : sourceKeyIsUnique && candidates.size === 1
        ? Array.from(candidates.values())[0]
        : null;
    if (resolved) resolvedWholesaleByLicenseeId.set(row.licenseeId, resolved);
  });

  const importedIds = new Set(selection.selected.map((row) => row.licenseeId));
  const blockedTypeConflicts = selection.selected.filter((row) => {
    const account = officialByLicenseeId.get(row.licenseeId);
    return account && account.type !== AccountType.BAR_RESTAURANT;
  });
  const blockedWholesaleConflicts = selection.selected.filter((row) => conflictingWholesaleIds.has(row.licenseeId));
  const blockedIds = new Set([
    ...blockedTypeConflicts.map((row) => row.licenseeId),
    ...blockedWholesaleConflicts.map((row) => row.licenseeId),
  ]);
  const importRows = selection.selected.filter((row) => !blockedIds.has(row.licenseeId));
  const importLocationGroups = groupAccountMasterRowsByLocation(importRows);
  const resolvedAccountsForGroup = (rows: AccountMasterRow[]) => {
    const resolved = new Map(
      rows
      .map((row) => resolvedWholesaleByLicenseeId.get(row.licenseeId))
      .filter(Boolean)
      .map((account) => [account!.id, account!]),
    );
    if (resolved.size <= 1) return resolved;
    const sourceAddressMatches = new Map(
      Array.from(resolved.values())
        .filter((account) => rows.some((row) => areOhlqAddressesSame(row, account)))
        .map((account) => [account.id, account]),
    );
    if (sourceAddressMatches.size === 1) return sourceAddressMatches;
    const candidates = sourceAddressMatches.size > 1 ? sourceAddressMatches : resolved;
    const activeCandidates = new Map(
      Array.from(candidates.values()).filter((account) => account.isActive).map((account) => [account.id, account]),
    );
    return activeCandidates.size === 1 ? activeCandidates : candidates;
  };
  const locationPlans = importLocationGroups.map((rows) => {
    const accounts = resolvedAccountsForGroup(rows);
    return { rows, account: accounts.size === 1 ? Array.from(accounts.values())[0] : null, accounts };
  });
  const blockedLocationPlans = locationPlans.filter(({ accounts }) => accounts.size > 1);
  const plansByWholesaleId = new Map<string, typeof locationPlans>();
  locationPlans.forEach((plan) => {
    if (!plan.account) return;
    plansByWholesaleId.set(plan.account.id, [...(plansByWholesaleId.get(plan.account.id) ?? []), plan]);
  });
  const unresolvedAccountReuse: typeof locationPlans = [];
  plansByWholesaleId.forEach((plans) => {
    if (plans.length <= 1) return;
    const account = plans[0].account!;
    const addressMatches = plans.filter(({ rows }) => rows.some((row) => areOhlqAddressesSame(row, account)));
    if (addressMatches.length === plans.length) return;
    const primaryIdMatches = plans.filter(({ rows }) =>
      rows.some((row) => row.licenseeId === account.licenseeId.trim().toUpperCase()),
    );
    const destinationPlan = addressMatches.length === 1
      ? addressMatches[0]
      : primaryIdMatches.length === 1
        ? primaryIdMatches[0]
        : null;
    if (!destinationPlan) {
      unresolvedAccountReuse.push(...plans);
      return;
    }
    plans.forEach((plan) => {
      if (plan !== destinationPlan) plan.account = null;
    });
  });
  const newWholesaleLocationPlans = locationPlans.filter(({ account, accounts }) => !account && accounts.size <= 1);
  const existingWholesaleIds = new Set(locationPlans.map(({ account }) => account?.id).filter(Boolean) as string[]);
  const closedOfficialAccounts = wholesaleAccounts.filter(
    (account) =>
      account.isActive &&
      !account.mergedIntoId &&
      Boolean(account.officialAccountId) &&
      !getWholesaleLicenseeIdValues(account).some((licenseeId) => importedIds.has(licenseeId)),
  );

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    environment: runtime.appEnvironment,
    sourceFile: path.basename(sourcePath),
    sourceSha256: sourceHash,
    parsedRows: selection.parsedRows,
    excludedTransientRows: selection.excludedTransientRows,
    duplicateGroups: selection.duplicateGroups,
    selectedLicenseeIds: selection.selected.length,
    ambiguousLicenseeIds: selection.ambiguous.length,
    blockedTypeConflicts: blockedTypeConflicts.length,
    blockedWholesaleConflicts: blockedWholesaleConflicts.length,
    blockedLocationConflicts: blockedLocationPlans.length,
    unresolvedAccountReuseConflicts: new Set(unresolvedAccountReuse.map(({ account }) => account?.id).filter(Boolean)).size,
    sourceLocationGroups: importLocationGroups.length,
    consolidatedLicenseeAliases: importRows.length - importLocationGroups.length,
    existingWholesaleAccountsMatched: existingWholesaleIds.size,
    wholesaleAccountsToCreate: newWholesaleLocationPlans.length,
    maximumNewLocations,
    newWholesaleLocationExamples: newWholesaleLocationPlans.slice(0, 20).map(({ rows }) => ({
      location: `${rows[0]?.address ?? ''} | ${rows[0]?.city ?? ''} | ${rows[0]?.zip ?? ''}`,
      names: Array.from(new Set(rows.map((row) => row.name))),
      sourceLicenseeIds: rows.map((row) => row.licenseeId),
    })),
    closedOfficialAccountsToDeactivate: closedOfficialAccounts.length,
    maximumDeactivations,
    ambiguousExamples: selection.ambiguous.slice(0, 20).map((group) => ({
      licenseeId: group.licenseeId,
      candidates: group.rows.map((row) => `${row.name} | ${row.address ?? ''} | ${row.city ?? ''}`),
    })),
    blockedExamples: [...blockedTypeConflicts, ...blockedWholesaleConflicts].slice(0, 20).map((row) => row.licenseeId),
    blockedLocationExamples: blockedLocationPlans.slice(0, 20).map(({ rows, accounts }) => ({
      accounts: Array.from(accounts.values()).map(
        (account) => `${account.name} | ${account.licenseeId} | ${account.address ?? ''} | ${account.city ?? ''} | ${account.zip ?? ''}`,
      ),
      sourceLicenseeIds: rows.map((row) => row.licenseeId),
    })),
    unresolvedAccountReuseExamples: unresolvedAccountReuse.slice(0, 20).map(({ account, rows }) => ({
      account: account ? `${account.name} | ${account.licenseeId} | ${account.address ?? ''} | ${account.city ?? ''} | ${account.zip ?? ''}` : null,
      sourceLocation: `${rows[0]?.address ?? ''} | ${rows[0]?.city ?? ''} | ${rows[0]?.zip ?? ''}`,
      sourceLicenseeIds: rows.map((row) => row.licenseeId),
    })),
    explainedSelection: explainLicenseeId
      ? selection.selected.find((row) => row.licenseeId === explainLicenseeId) ??
        selection.ambiguous.find((group) => group.licenseeId === explainLicenseeId) ??
        null
      : undefined,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) return;
  assertSideEffectEnabled('ohlqImport');
  if (selection.ambiguous.length || blockedIds.size || blockedLocationPlans.length || unresolvedAccountReuse.length) {
    throw new Error('Apply refused because ambiguous Licensee IDs or conflicting wholesale locations remain. Resolve them before importing.');
  }
  if (newWholesaleLocationPlans.length > maximumNewLocations) {
    throw new Error(
      `Apply refused because ${newWholesaleLocationPlans.length} new locations exceed the safety limit of ${maximumNewLocations}.`,
    );
  }
  if (closedOfficialAccounts.length > maximumDeactivations) {
    throw new Error(
      `Apply refused because ${closedOfficialAccounts.length} deactivations exceed the safety limit of ${maximumDeactivations}.`,
    );
  }

  logEnvironmentEvent('ohlq.account-master.started', { sourceHash, selectedLicenseeIds: importRows.length });

  const officialIdsByLicenseeId = new Map<string, string>();
  for (let offset = 0; offset < importRows.length; offset += 500) {
    const batch = importRows.slice(offset, offset + 500).map((row) => ({ id: randomUUID(), ...row }));
    const officials = await prisma.$queryRaw<Array<{ id: string; licenseeId: string }>>`
      INSERT INTO "Account" (
        "id", "type", "licenseeId", "name", "address", "city", "county", "state", "zip", "phone",
        "ownership", "agencyRefId", "districtId", "deliveryDay", "createdAt", "updatedAt"
      )
      SELECT
        source."id", 'BAR_RESTAURANT'::"AccountType", source."licenseeId", source."name", source."address",
        source."city", source."county", source."state", source."zip", source."phone", source."ownership",
        source."agencyId", source."districtId", source."deliveryDay", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS source(
        "id" text, "licenseeId" text, "name" text, "address" text, "city" text, "county" text, "state" text,
        "zip" text, "phone" text, "ownership" text, "agencyId" text, "districtId" text, "deliveryDay" text
      )
      ON CONFLICT ("licenseeId") DO UPDATE SET
        "type" = EXCLUDED."type",
        "name" = EXCLUDED."name",
        "address" = EXCLUDED."address",
        "city" = EXCLUDED."city",
        "county" = EXCLUDED."county",
        "state" = EXCLUDED."state",
        "zip" = EXCLUDED."zip",
        "phone" = EXCLUDED."phone",
        "ownership" = EXCLUDED."ownership",
        "agencyRefId" = EXCLUDED."agencyRefId",
        "districtId" = EXCLUDED."districtId",
        "deliveryDay" = EXCLUDED."deliveryDay",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", "licenseeId"
    `;
    officials.forEach((official) => officialIdsByLicenseeId.set(official.licenseeId.trim().toUpperCase(), official.id));
    console.log(`Official accounts: ${Math.min(offset + batch.length, importRows.length)}/${importRows.length}`);
  }

  const rowsByWholesaleId = new Map<string, AccountMasterRow[]>();
  const rowsForNewWholesale = new Map<string, AccountMasterRow[]>();
  locationPlans.forEach(({ rows, account }) => {
    if (account) rowsByWholesaleId.set(account.id, [...(rowsByWholesaleId.get(account.id) ?? []), ...rows]);
    else {
      const primaryRow = choosePrimaryAccountMasterRow(rows);
      rowsForNewWholesale.set(primaryRow.licenseeId, rows);
    }
  });

  const existingUpdates = Array.from(rowsByWholesaleId.entries());
  for (let offset = 0; offset < existingUpdates.length; offset += 100) {
    const batch = existingUpdates.slice(offset, offset + 100);
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const [wholesaleId, rows] of batch) {
        const account = wholesaleAccounts.find((candidate) => candidate.id === wholesaleId)!;
        const primaryRow = rows.find((row) => row.licenseeId === account.licenseeId.trim().toUpperCase()) ??
          choosePrimaryAccountMasterRow(rows);
        const officialAccountId = account.officialAccountId ?? officialIdsByLicenseeId.get(primaryRow.licenseeId);
        const sourceValues = values(primaryRow);
        operations.push(prisma.wholesaleAccount.update({
          where: { id: wholesaleId },
          data: {
            isActive: true,
            officialAccountId,
            name: getImportedWholesaleName({ currentName: account.name, officialName: primaryRow.name, wasActive: account.isActive }),
            address: sourceValues.address ?? account.address,
            agencyId: sourceValues.agencyId ?? account.agencyId,
            city: sourceValues.city ?? account.city,
            county: sourceValues.county ?? account.county,
            deliveryDay: sourceValues.deliveryDay ?? account.deliveryDay,
            districtId: sourceValues.districtId ?? account.districtId,
            ownership: sourceValues.ownership ?? account.ownership,
            phone: sourceValues.phone ?? account.phone,
            state: sourceValues.state ?? account.state,
            zip: sourceValues.zip ?? account.zip,
            ...getGeocodeResetForAddressChange(account, {
              address: sourceValues.address ?? account.address,
              city: sourceValues.city ?? account.city,
              state: sourceValues.state ?? account.state,
              zip: sourceValues.zip ?? account.zip,
            }),
          },
        }));
        for (const row of rows) {
          operations.push(prisma.wholesaleLicenseeId.upsert({
            where: { licenseeId: row.licenseeId },
            create: { wholesaleAccountId: wholesaleId, licenseeId: row.licenseeId, isPrimary: row.licenseeId === account.licenseeId },
            update: { wholesaleAccountId: wholesaleId, isPrimary: row.licenseeId === account.licenseeId },
          }));
        }
    }
    await prisma.$transaction(operations);
    if (offset % 1000 === 0) console.log(`Existing wholesale accounts: ${Math.min(offset + batch.length, existingUpdates.length)}/${existingUpdates.length}`);
  }

  const newLocationGroups = Array.from(rowsForNewWholesale.values());
  for (let offset = 0; offset < newLocationGroups.length; offset += 500) {
    const batch = newLocationGroups.slice(offset, offset + 500);
    const primaryRows = batch.map(choosePrimaryAccountMasterRow);
    await prisma.wholesaleAccount.createMany({
      data: primaryRows.map((row) => ({
        ...values(row),
        isActive: true,
        licenseeId: row.licenseeId,
        name: row.name,
        officialAccountId: officialIdsByLicenseeId.get(row.licenseeId),
      })),
      skipDuplicates: true,
    });
    const createdAccounts = await prisma.wholesaleAccount.findMany({
      where: { licenseeId: { in: primaryRows.map((row) => row.licenseeId) } },
      select: { id: true, licenseeId: true },
    });
    const createdByPrimaryLicenseeId = new Map(createdAccounts.map((account) => [account.licenseeId, account]));
    const aliasOperations: Prisma.PrismaPromise<unknown>[] = [];
    batch.forEach((rows, index) => {
        const primaryRow = primaryRows[index];
        const account = createdByPrimaryLicenseeId.get(primaryRow.licenseeId);
        if (!account) return;
        rows.forEach((row) => aliasOperations.push(prisma.wholesaleLicenseeId.upsert({
          where: { licenseeId: row.licenseeId },
          create: { wholesaleAccountId: account.id, licenseeId: row.licenseeId, isPrimary: row.licenseeId === primaryRow.licenseeId },
          update: { wholesaleAccountId: account.id, isPrimary: row.licenseeId === primaryRow.licenseeId },
        })));
    });
    if (aliasOperations.length) await prisma.$transaction(aliasOperations);
    console.log(`New wholesale accounts: ${Math.min(offset + batch.length, newLocationGroups.length)}/${newLocationGroups.length}`);
  }

  if (closedOfficialAccounts.length > 0) {
    await prisma.wholesaleAccount.updateMany({
      where: { id: { in: closedOfficialAccounts.map((account) => account.id) } },
      data: { isActive: false },
    });
  }

  const [activeCount, placeholderCount, finalWholesaleAccounts] = await Promise.all([
    prisma.wholesaleAccount.count({ where: { isActive: true, mergedIntoId: null } }),
    prisma.wholesaleAccount.count({
      where: { isActive: true, mergedIntoId: null, name: { startsWith: 'Licensee ', mode: 'insensitive' } },
    }),
    prisma.wholesaleAccount.findMany({
      where: { mergedIntoId: null },
      select: {
        id: true,
        name: true,
        licenseeId: true,
        address: true,
        licenseeIds: { select: { licenseeId: true } },
      },
    }),
  ]);
  const representedLicenseeIds = new Set(finalWholesaleAccounts.flatMap((account) => getWholesaleLicenseeIdValues(account)));
  const missingImportedLicenseeIds = importRows.filter((row) => !representedLicenseeIds.has(row.licenseeId));
  const activeNameChanges = finalWholesaleAccounts.filter(
    (account) => namesToPreserve.has(account.id) && namesToPreserve.get(account.id) !== account.name,
  );
  const activeAccountsMissingAddress = await prisma.wholesaleAccount.count({
    where: { isActive: true, mergedIntoId: null, OR: [{ address: null }, { address: '' }] },
  });
  const verification = {
    activeCount,
    placeholderCount,
    missingImportedLicenseeIds: missingImportedLicenseeIds.length,
    preservedActiveNameChanges: activeNameChanges.length,
    activeAccountsMissingAddress,
  };
  logEnvironmentEvent('ohlq.account-master.completed', { sourceHash, ...verification });
  console.log(JSON.stringify({ applied: true, ...verification }, null, 2));
  if (missingImportedLicenseeIds.length || activeNameChanges.length) {
    throw new Error('Post-import verification failed. Review missing Licensee IDs or changed active names.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
