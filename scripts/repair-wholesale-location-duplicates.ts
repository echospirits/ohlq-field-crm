import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { validateRuntimeEnvironment, logEnvironmentEvent } from '../lib/appEnvironment';
import {
  groupAccountMasterRowsByLocation,
  groupWholesaleLocationIdentities,
  parseAccountMasterCsv,
  rowMatchesWholesaleImportIdentity,
  type ExistingAccountIdentity,
} from '../lib/ohlqAccountMasterImport';
import {
  getOhlqLicenseeMatchKeys,
} from '../lib/ohlqWholesaleMatching';
import {
  getWholesaleLicenseeIdValues,
  isGeneratedWholesaleLicenseeId,
  parseWholesaleLicenseeIds,
  syncWholesaleAccountLicenseeIds,
} from '../lib/wholesaleAccounts';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const getArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
};
const expectedEnvironment = getArg('--environment');
const recoverySnapshot = getArg('--recovery-snapshot');
const importedAfterValue = getArg('--imported-after');
const sourcePathValue = getArg('--source-file');
const sourcePath = sourcePathValue ? path.resolve(sourcePathValue) : '';

type RepairAccount = Awaited<ReturnType<typeof loadAccounts>>[number];

const loadAccounts = () => prisma.wholesaleAccount.findMany({
  where: { isActive: true, mergedIntoId: null },
  select: {
    address: true,
    agencyId: true,
    city: true,
    county: true,
    createdAt: true,
    createdByUserId: true,
    deliveryDay: true,
    districtId: true,
    id: true,
    isActive: true,
    licenseeId: true,
    licenseeIds: { select: { licenseeId: true } },
    mergedIntoId: true,
    name: true,
    officialAccountId: true,
    ohlqLastEchoPurchaseBottles: true,
    ohlqLastEchoPurchaseDate: true,
    ohlqLastEchoPurchaseItemCode: true,
    ohlqLastEchoPurchaseItemName: true,
    ohlqLastEchoPurchaseUpdatedAt: true,
    ownership: true,
    phone: true,
    state: true,
    zip: true,
  },
});

const combineRepairGroups = (accounts: RepairAccount[], groups: RepairAccount[][]) => {
  const parent = new Map(accounts.map((account) => [account.id, account.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  groups.forEach((group) => group.slice(1).forEach((account) => parent.set(find(account.id), find(group[0].id))));
  const components = new Map<string, RepairAccount[]>();
  accounts.forEach((account) => {
    const root = find(account.id);
    components.set(root, [...(components.get(root) ?? []), account]);
  });
  return Array.from(components.values()).filter((group) => group.length > 1);
};

const getRepairClusters = (accounts: RepairAccount[], sourceContents?: string) => {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const identityGroups = groupWholesaleLocationIdentities(
    accounts.map((account) => ({
    ...account,
    licenseeIds: getWholesaleLicenseeIdValues(account),
    })),
  )
    .filter((group) => group.length > 1)
    .map((group) => group.map((account) => accountsById.get(account.id)!));
  if (!sourceContents) return identityGroups;

  const accountByLicenseeId = new Map<string, RepairAccount>();
  const accountsByMatchKey = new Map<string, Map<string, RepairAccount>>();
  const sourceIdentities = new Map<string, ExistingAccountIdentity[]>();
  accounts.forEach((account) => getWholesaleLicenseeIdValues(account).forEach((licenseeId) => {
    const normalizedLicenseeId = licenseeId.trim().toUpperCase();
    accountByLicenseeId.set(normalizedLicenseeId, account);
    sourceIdentities.set(normalizedLicenseeId, [
      ...(sourceIdentities.get(normalizedLicenseeId) ?? []),
      {
        name: account.name,
        address: account.address,
        city: account.city,
        zip: account.zip,
        agencyId: account.agencyId,
      },
    ]);
    getOhlqLicenseeMatchKeys(licenseeId).forEach((matchKey) => {
      const matches = accountsByMatchKey.get(matchKey) ?? new Map<string, RepairAccount>();
      matches.set(account.id, account);
      accountsByMatchKey.set(matchKey, matches);
    });
  }));
  const resolveSourceRow = (row: ReturnType<typeof parseAccountMasterCsv>['selected'][number]) => {
    const exact = accountByLicenseeId.get(row.licenseeId);
    if (exact) return exact;
    const candidates = new Map<string, RepairAccount>();
    getOhlqLicenseeMatchKeys(row.licenseeId).forEach((matchKey) =>
      accountsByMatchKey.get(matchKey)?.forEach((account) => candidates.set(account.id, account)),
    );
    const strongMatches = Array.from(candidates.values()).filter((account) => rowMatchesWholesaleImportIdentity(row, account));
    return strongMatches.length === 1 ? strongMatches[0] : null;
  };
  const sourceGroups = groupAccountMasterRowsByLocation(parseAccountMasterCsv(sourceContents, sourceIdentities).selected)
    .map((rows) => Array.from(new Map(
      rows
        .map(resolveSourceRow)
        .filter(Boolean)
        .map((account) => [account!.id, account!]),
    ).values()))
    .filter((group) => group.length > 1);
  return combineRepairGroups(accounts, [...identityGroups, ...sourceGroups]);
};

const loadActivityCounts = async () => {
  const rows = await prisma.$queryRaw<Array<{ id: string; count: bigint }>>`
    SELECT "wholesaleAccountId" AS id, SUM(count)::bigint AS count
    FROM (
      SELECT "wholesaleAccountId", COUNT(*) AS count FROM "LoggedVisit" WHERE "wholesaleAccountId" IS NOT NULL GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "WorklistItem" WHERE "wholesaleAccountId" IS NOT NULL GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "LocationContact" WHERE "wholesaleAccountId" IS NOT NULL GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "LocationTag" WHERE "wholesaleAccountId" IS NOT NULL GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "MenuPlacement" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "RecipeSuggestion" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "SalesOpportunity" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "OpportunityAccountSignal" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "AccountSalesEvent" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "OpportunityEvent" GROUP BY 1
      UNION ALL SELECT "bestEntryWholesaleAccountId", COUNT(*) FROM "TargetOwnershipGroup" WHERE "bestEntryWholesaleAccountId" IS NOT NULL GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetAccountProfile" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetAccountScoreHistory" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetAccountMetric" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetPublicResearch" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetSkuOpportunity" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetHeatLossAlert" GROUP BY 1
      UNION ALL SELECT "wholesaleAccountId", COUNT(*) FROM "TargetChainMembership" GROUP BY 1
    ) activity
    GROUP BY "wholesaleAccountId"
  `;
  return new Map(rows.map((row) => [row.id, Number(row.count)]));
};

const loadTargetDataAccountIds = async () => {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT "wholesaleAccountId" AS id
    FROM (
      SELECT "wholesaleAccountId" FROM "TargetAccountProfile"
      UNION ALL SELECT "wholesaleAccountId" FROM "TargetAccountScoreHistory"
      UNION ALL SELECT "wholesaleAccountId" FROM "TargetAccountMetric"
      UNION ALL SELECT "wholesaleAccountId" FROM "TargetPublicResearch"
      UNION ALL SELECT "wholesaleAccountId" FROM "TargetSkuOpportunity"
      UNION ALL SELECT "wholesaleAccountId" FROM "TargetHeatLossAlert"
      UNION ALL SELECT "wholesaleAccountId" FROM "TargetChainMembership"
    ) target_data
  `;
  return new Set(rows.map((row) => row.id));
};

const chooseDestination = (accounts: RepairAccount[], activityCounts: Map<string, number>, importedAfter: Date) =>
  [...accounts].sort((left, right) =>
    Number(right.createdAt < importedAfter) - Number(left.createdAt < importedAfter) ||
    (activityCounts.get(right.id) ?? 0) - (activityCounts.get(left.id) ?? 0) ||
    Number(!right.officialAccountId) - Number(!left.officialAccountId) ||
    Number(Boolean(right.createdByUserId)) - Number(Boolean(left.createdByUserId)) ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id),
  )[0];

const moveSignals = async (tx: Prisma.TransactionClient, sourceIds: string[], targetId: string) => {
  const targetOrganizations = await tx.opportunityAccountSignal.findMany({
    where: { wholesaleAccountId: targetId },
    select: { organizationId: true },
  });
  if (targetOrganizations.length) {
    await tx.opportunityAccountSignal.deleteMany({
      where: {
        wholesaleAccountId: { in: sourceIds },
        organizationId: { in: targetOrganizations.map(({ organizationId }) => organizationId) },
      },
    });
  }
  await tx.opportunityAccountSignal.updateMany({
    where: { wholesaleAccountId: { in: sourceIds } },
    data: { wholesaleAccountId: targetId },
  });
};

const moveTargetIntelligence = async (tx: Prisma.TransactionClient, sourceIds: string[], targetId: string) => {
  for (const sourceId of sourceIds) {
    const targetProfileOrganizations = await tx.targetAccountProfile.findMany({
      where: { wholesaleAccountId: targetId },
      select: { organizationId: true },
    });
    await tx.targetAccountProfile.deleteMany({
      where: {
        wholesaleAccountId: sourceId,
        organizationId: { in: targetProfileOrganizations.map(({ organizationId }) => organizationId) },
      },
    });
    await tx.targetAccountProfile.updateMany({
      where: { wholesaleAccountId: sourceId },
      data: { wholesaleAccountId: targetId },
    });

    const scoreRows = await tx.targetAccountScoreHistory.findMany({
      where: { wholesaleAccountId: sourceId },
      select: { id: true, scoringDate: true, modelVersion: true, sourceRowHash: true },
    });
    for (const row of scoreRows) {
      const collision = await tx.targetAccountScoreHistory.findFirst({
        where: {
          wholesaleAccountId: targetId,
          scoringDate: row.scoringDate,
          modelVersion: row.modelVersion,
          sourceRowHash: row.sourceRowHash,
        },
        select: { id: true },
      });
      if (collision) await tx.targetAccountScoreHistory.delete({ where: { id: row.id } });
      else await tx.targetAccountScoreHistory.update({ where: { id: row.id }, data: { wholesaleAccountId: targetId } });
    }

    const metricRows = await tx.targetAccountMetric.findMany({
      where: { wholesaleAccountId: sourceId },
      select: { id: true, periodStart: true, periodEnd: true, modelVersion: true },
    });
    for (const row of metricRows) {
      const collision = await tx.targetAccountMetric.findFirst({
        where: {
          wholesaleAccountId: targetId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          modelVersion: row.modelVersion,
        },
        select: { id: true },
      });
      if (collision) await tx.targetAccountMetric.delete({ where: { id: row.id } });
      else await tx.targetAccountMetric.update({ where: { id: row.id }, data: { wholesaleAccountId: targetId } });
    }

    const existingResearch = await tx.targetPublicResearch.findUnique({
      where: { wholesaleAccountId: targetId },
      select: { id: true },
    });
    if (existingResearch) await tx.targetPublicResearch.deleteMany({ where: { wholesaleAccountId: sourceId } });
    else await tx.targetPublicResearch.updateMany({ where: { wholesaleAccountId: sourceId }, data: { wholesaleAccountId: targetId } });

    const skuRows = await tx.targetSkuOpportunity.findMany({
      where: { wholesaleAccountId: sourceId },
      select: { id: true, productName: true, opportunityType: true, modelVersion: true },
    });
    for (const row of skuRows) {
      const collision = await tx.targetSkuOpportunity.findFirst({
        where: {
          wholesaleAccountId: targetId,
          productName: row.productName,
          opportunityType: row.opportunityType,
          modelVersion: row.modelVersion,
        },
        select: { id: true },
      });
      if (collision) await tx.targetSkuOpportunity.delete({ where: { id: row.id } });
      else await tx.targetSkuOpportunity.update({ where: { id: row.id }, data: { wholesaleAccountId: targetId } });
    }

    const alertRows = await tx.targetHeatLossAlert.findMany({
      where: { wholesaleAccountId: sourceId },
      select: { id: true, type: true },
    });
    for (const row of alertRows) {
      const collision = await tx.targetHeatLossAlert.findFirst({
        where: { wholesaleAccountId: targetId, type: row.type },
        select: { id: true },
      });
      if (collision) await tx.targetHeatLossAlert.delete({ where: { id: row.id } });
      else await tx.targetHeatLossAlert.update({ where: { id: row.id }, data: { wholesaleAccountId: targetId } });
    }

    const membershipRows = await tx.targetChainMembership.findMany({
      where: { wholesaleAccountId: sourceId },
      select: { id: true, ownershipGroupId: true },
    });
    for (const row of membershipRows) {
      const collision = await tx.targetChainMembership.findFirst({
        where: { wholesaleAccountId: targetId, ownershipGroupId: row.ownershipGroupId },
        select: { id: true },
      });
      if (collision) await tx.targetChainMembership.delete({ where: { id: row.id } });
      else await tx.targetChainMembership.update({ where: { id: row.id }, data: { wholesaleAccountId: targetId } });
    }
  }
};

const mergeCluster = async (
  cluster: RepairAccount[],
  destination: RepairAccount,
) => {
  const sources = cluster.filter((account) => account.id !== destination.id);
  const sourceIds = sources.map((account) => account.id);
  const licenseeIds = parseWholesaleLicenseeIds(
    cluster.flatMap(getWholesaleLicenseeIdValues).filter((id) => !isGeneratedWholesaleLicenseeId(id)).join('\n'),
  );
  const newestPurchase = [...cluster]
    .filter((account) => account.ohlqLastEchoPurchaseDate)
    .sort((left, right) => right.ohlqLastEchoPurchaseDate!.getTime() - left.ohlqLastEchoPurchaseDate!.getTime())[0];
  const officialAccountId = destination.officialAccountId ?? sources.find((source) => source.officialAccountId)?.officialAccountId ?? null;

  await prisma.$transaction(async (tx) => {
    const targetTags = await tx.locationTag.findMany({
      where: { wholesaleAccountId: destination.id },
      select: { organizationId: true, tagId: true },
    });
    for (const tag of targetTags) {
      await tx.locationTag.deleteMany({ where: { wholesaleAccountId: { in: sourceIds }, ...tag } });
    }
    const targetRecipes = await tx.recipeSuggestion.findMany({
      where: { wholesaleAccountId: destination.id },
      select: { organizationId: true, recipeId: true },
    });
    for (const recipe of targetRecipes) {
      await tx.recipeSuggestion.deleteMany({ where: { wholesaleAccountId: { in: sourceIds }, ...recipe } });
    }

    await Promise.all([
      tx.loggedVisit.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.worklistItem.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.locationContact.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.locationTag.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.menuPlacement.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.recipeSuggestion.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.salesOpportunity.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.accountSalesEvent.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.opportunityEvent.updateMany({ where: { wholesaleAccountId: { in: sourceIds } }, data: { wholesaleAccountId: destination.id } }),
      tx.targetOwnershipGroup.updateMany({ where: { bestEntryWholesaleAccountId: { in: sourceIds } }, data: { bestEntryWholesaleAccountId: destination.id } }),
    ]);
    await moveSignals(tx, sourceIds, destination.id);
    await moveTargetIntelligence(tx, sourceIds, destination.id);

    for (const source of sources) {
      await tx.wholesaleAccount.update({
        where: { id: source.id },
        data: {
          isActive: false,
          licenseeId: `merged-${source.id}`,
          officialAccountId: null,
          mergedAt: new Date(),
          mergedIntoId: destination.id,
          mergeSnapshot: {
            reason: 'automatic-location-deduplication',
            recoverySnapshot,
            address: source.address,
            agencyId: source.agencyId,
            city: source.city,
            county: source.county,
            deliveryDay: source.deliveryDay,
            districtId: source.districtId,
            licenseeIds: getWholesaleLicenseeIdValues(source),
            name: source.name,
            officialAccountId: source.officialAccountId,
            ownership: source.ownership,
            phone: source.phone,
            state: source.state,
            zip: source.zip,
          },
        },
      });
    }
    await tx.wholesaleLicenseeId.deleteMany({ where: { wholesaleAccountId: { in: sourceIds } } });
    await syncWholesaleAccountLicenseeIds(tx, destination.id, licenseeIds);
    await tx.wholesaleAccount.update({
      where: { id: destination.id },
      data: {
        isActive: true,
        officialAccountId,
        ...(newestPurchase
          ? {
              ohlqLastEchoPurchaseBottles: newestPurchase.ohlqLastEchoPurchaseBottles,
              ohlqLastEchoPurchaseDate: newestPurchase.ohlqLastEchoPurchaseDate,
              ohlqLastEchoPurchaseItemCode: newestPurchase.ohlqLastEchoPurchaseItemCode,
              ohlqLastEchoPurchaseItemName: newestPurchase.ohlqLastEchoPurchaseItemName,
              ohlqLastEchoPurchaseUpdatedAt: newestPurchase.ohlqLastEchoPurchaseUpdatedAt,
            }
          : {}),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 20_000, timeout: 120_000 });
};

async function main() {
  if (!['test', 'production'].includes(expectedEnvironment)) throw new Error('Pass --environment test or production.');
  if (!recoverySnapshot) throw new Error('Pass the confirmed Neon snapshot ID with --recovery-snapshot.');
  if (sourcePath && !existsSync(sourcePath)) throw new Error('The --source-file path does not exist.');
  const importedAfter = new Date(importedAfterValue);
  if (!importedAfterValue || Number.isNaN(importedAfter.getTime())) throw new Error('Pass a valid --imported-after timestamp.');
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== expectedEnvironment) {
    throw new Error(`Requested ${expectedEnvironment}, but APP_ENV=${runtime.appEnvironment}.`);
  }

  const [accounts, activityCounts, targetDataAccountIds] = await Promise.all([
    loadAccounts(),
    loadActivityCounts(),
    loadTargetDataAccountIds(),
  ]);
  const sourceContents = sourcePath ? readFileSync(sourcePath, 'utf8') : undefined;
  const clusters = getRepairClusters(accounts, sourceContents);
  const plans = clusters.map((cluster) => {
    const destination = chooseDestination(cluster, activityCounts, importedAfter);
    const targetDataAccounts = cluster.filter((account) => targetDataAccountIds.has(account.id));
    return { cluster, destination, targetDataAccounts };
  });
  const targetCollisionPlans = plans.filter(({ targetDataAccounts }) => targetDataAccounts.length > 1);
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    environment: runtime.appEnvironment,
    recoverySnapshot,
    sourceFile: sourcePath ? path.basename(sourcePath) : null,
    activeAccountsBefore: accounts.length,
    duplicateClusters: clusters.length,
    accountsInDuplicateClusters: clusters.reduce((total, cluster) => total + cluster.length, 0),
    accountsToConsolidate: clusters.reduce((total, cluster) => total + cluster.length - 1, 0),
    targetIntelligenceCollisionClusters: targetCollisionPlans.length,
    examples: plans.slice(0, 12).map(({ cluster, destination }) => ({
      destination: `${destination.name} | ${destination.licenseeId}`,
      accounts: cluster.map((account) => `${account.name} | ${account.licenseeId}`),
    })),
    targetIntelligenceCollisionExamples: targetCollisionPlans.slice(0, 12).map(({ cluster }) => cluster.map((account) => `${account.name} | ${account.licenseeId}`)),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) return;

  logEnvironmentEvent('wholesale.location-deduplication.started', {
    recoverySnapshot,
    duplicateClusters: clusters.length,
    accountsToConsolidate: summary.accountsToConsolidate,
  });
  for (const [index, plan] of plans.entries()) {
    await mergeCluster(plan.cluster, plan.destination);
    if (index % 25 === 0 || index === plans.length - 1) console.log(`Consolidated ${index + 1}/${plans.length} clusters`);
  }

  const finalAccounts = await loadAccounts();
  const remainingClusters = getRepairClusters(finalAccounts, sourceContents);
  const finalSummary = {
    applied: true,
    activeAccountsAfter: finalAccounts.length,
    consolidatedAccounts: accounts.length - finalAccounts.length,
    remainingDuplicateClusters: remainingClusters.length,
  };
  logEnvironmentEvent('wholesale.location-deduplication.completed', { recoverySnapshot, ...finalSummary });
  console.log(JSON.stringify(finalSummary, null, 2));
  if (remainingClusters.length) throw new Error('Post-repair verification found remaining high-confidence duplicate clusters.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
