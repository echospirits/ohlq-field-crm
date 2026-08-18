import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import {
  getWholesaleLicenseeIdValues,
  isGeneratedWholesaleLicenseeId,
  parseWholesaleLicenseeIds,
  syncWholesaleAccountLicenseeIds,
} from './wholesaleAccounts';

export type MergeAccountValues = {
  address: string | null;
  agencyId: string | null;
  city: string | null;
  county: string | null;
  deliveryDay: string | null;
  districtId: string | null;
  licenseeId: string;
  licenseeIds: { licenseeId: string }[];
  name: string;
  ownership: string | null;
  phone: string | null;
  state: string | null;
  zip: string | null;
};

export type WholesaleMergeCandidate = Pick<
  MergeAccountValues,
  'address' | 'city' | 'licenseeId' | 'licenseeIds' | 'name' | 'state' | 'zip'
> & {
  id: string;
  isActive: boolean;
  mergedIntoId: string | null;
  officialAccountId: string | null;
};

const MERGE_CANDIDATE_LIMIT = 50;
const SEARCH_STOP_WORDS = new Set(['and', 'at', 'of', 'the']);

const normalizeMergeText = (value: string | null | undefined) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeMergeAddress = (value: string | null | undefined) =>
  normalizeMergeText(value)
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\broad\b/g, 'rd')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bhighway\b/g, 'hwy')
    .replace(/\bsuite\b/g, 'ste');

const getSignificantTokens = (value: string) => {
  const tokens = value.split(' ').filter(Boolean);
  const significant = tokens.filter((token) => !SEARCH_STOP_WORDS.has(token));
  return significant.length > 0 ? significant : tokens;
};

const getTokenOverlap = (left: string, right: string) => {
  const leftTokens = new Set(getSignificantTokens(left));
  const rightTokens = new Set(getSignificantTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  return intersection / Math.max(leftTokens.size, rightTokens.size);
};

const getSourceMatchScore = (source: WholesaleMergeCandidate, candidate: WholesaleMergeCandidate) => {
  const sourceName = normalizeMergeText(source.name);
  const candidateName = normalizeMergeText(candidate.name);
  let score = getTokenOverlap(sourceName, candidateName) * 2_000;

  if (sourceName && sourceName === candidateName) score += 6_000;
  else if (sourceName && (sourceName.includes(candidateName) || candidateName.includes(sourceName))) score += 3_000;

  const sourceAddress = normalizeMergeAddress(source.address);
  const candidateAddress = normalizeMergeAddress(candidate.address);
  if (sourceAddress && candidateAddress) {
    score += getTokenOverlap(sourceAddress, candidateAddress) * 1_000;
    if (sourceAddress === candidateAddress) score += 3_000;
  }

  const sourceCity = normalizeMergeText(source.city);
  const candidateCity = normalizeMergeText(candidate.city);
  if (sourceCity && sourceCity === candidateCity) score += 500;
  if (source.zip && candidate.zip && source.zip.trim() === candidate.zip.trim()) score += 750;

  return score;
};

const getSearchScore = (candidate: WholesaleMergeCandidate, query: string) => {
  const normalizedQuery = normalizeMergeText(query);
  if (!normalizedQuery) return 0;

  const fields = [
    candidate.name,
    candidate.licenseeId,
    ...candidate.licenseeIds.map(({ licenseeId }) => licenseeId),
    candidate.address,
    candidate.city,
    candidate.state,
    candidate.zip,
  ].map(normalizeMergeText).filter(Boolean);
  const combined = fields.join(' ');

  if (fields.some((field) => field === normalizedQuery)) return 10_000;
  if (fields.some((field) => field.startsWith(normalizedQuery))) return 8_000;
  if (fields.some((field) => field.includes(normalizedQuery))) return 6_000;

  const queryTokens = getSignificantTokens(normalizedQuery);
  if (queryTokens.length > 0 && queryTokens.every((token) => combined.includes(token))) {
    return 4_000 + getTokenOverlap(normalizedQuery, combined) * 1_000;
  }

  return Number.NEGATIVE_INFINITY;
};

export const isEligibleWholesaleMergeTarget = (candidate: WholesaleMergeCandidate) =>
  candidate.isActive &&
  !candidate.mergedIntoId &&
  (Boolean(candidate.officialAccountId) ||
    getWholesaleLicenseeIdValues(candidate).some((licenseeId) => !isGeneratedWholesaleLicenseeId(licenseeId)));

export function rankWholesaleMergeCandidates({
  candidates,
  query,
  source,
}: {
  candidates: WholesaleMergeCandidate[];
  query: string;
  source: WholesaleMergeCandidate;
}) {
  return candidates
    .filter(isEligibleWholesaleMergeTarget)
    .map((candidate) => ({
      candidate,
      searchScore: getSearchScore(candidate, query),
      sourceScore: getSourceMatchScore(source, candidate),
    }))
    .filter(({ searchScore }) => Number.isFinite(searchScore))
    .sort(
      (left, right) =>
        right.searchScore - left.searchScore ||
        right.sourceScore - left.sourceScore ||
        left.candidate.name.localeCompare(right.candidate.name) ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .map(({ candidate }) => candidate);
}

export async function getWholesaleMergeCandidates({
  db = prisma,
  query,
  source,
}: {
  db?: PrismaClient;
  query: string;
  source: WholesaleMergeCandidate;
}) {
  const allCandidates = await db.wholesaleAccount.findMany({
    where: {
      id: { not: source.id },
      isActive: true,
      mergedIntoId: null,
    },
    select: {
      address: true,
      city: true,
      id: true,
      isActive: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
      mergedIntoId: true,
      name: true,
      officialAccountId: true,
      state: true,
      zip: true,
    },
  });
  const eligibleCount = allCandidates.filter(isEligibleWholesaleMergeTarget).length;
  const rankedCandidates = rankWholesaleMergeCandidates({ candidates: allCandidates, query, source });

  return {
    candidates: rankedCandidates.slice(0, MERGE_CANDIDATE_LIMIT),
    eligibleCount,
    matchCount: rankedCandidates.length,
  };
}

export type WholesaleMergeErrorCode =
  | 'already-merged'
  | 'invalid-source'
  | 'invalid-target'
  | 'same-account'
  | 'source-is-official'
  | 'target-has-target-data-conflict'
  | 'target-is-not-official';

export class WholesaleMergeError extends Error {
  constructor(public readonly code: WholesaleMergeErrorCode, message: string) {
    super(message);
    this.name = 'WholesaleMergeError';
  }
}

const preferDestinationValue = (destination: string | null, source: string | null) =>
  destination?.trim() ? destination : source;

export const getWholesaleMergeDestinationFallbacks = (
  source: MergeAccountValues,
  destination: MergeAccountValues,
) => ({
  address: preferDestinationValue(destination.address, source.address),
  agencyId: preferDestinationValue(destination.agencyId, source.agencyId),
  city: preferDestinationValue(destination.city, source.city),
  county: preferDestinationValue(destination.county, source.county),
  deliveryDay: preferDestinationValue(destination.deliveryDay, source.deliveryDay),
  districtId: preferDestinationValue(destination.districtId, source.districtId),
  ownership: preferDestinationValue(destination.ownership, source.ownership),
  phone: preferDestinationValue(destination.phone, source.phone),
  state: preferDestinationValue(destination.state, source.state) ?? 'OH',
  zip: preferDestinationValue(destination.zip, source.zip),
});

export const getWholesaleMergeLicenseeIds = (
  source: Pick<MergeAccountValues, 'licenseeId' | 'licenseeIds'>,
  destination: Pick<MergeAccountValues, 'licenseeId' | 'licenseeIds'>,
) => {
  const destinationIds = getWholesaleLicenseeIdValues(destination);
  const transferableSourceIds = getWholesaleLicenseeIdValues(source).filter(
    (licenseeId) => !isGeneratedWholesaleLicenseeId(licenseeId),
  );

  return parseWholesaleLicenseeIds([...destinationIds, ...transferableSourceIds].join('\n'));
};

const getTargetRecordCount = async (db: Prisma.TransactionClient | typeof prisma, wholesaleAccountId: string) => {
  const counts = await Promise.all([
    db.targetAccountProfile.count({ where: { wholesaleAccountId } }),
    db.targetAccountScoreHistory.count({ where: { wholesaleAccountId } }),
    db.targetAccountMetric.count({ where: { wholesaleAccountId } }),
    db.targetPublicResearch.count({ where: { wholesaleAccountId } }),
    db.targetSkuOpportunity.count({ where: { wholesaleAccountId } }),
    db.targetHeatLossAlert.count({ where: { wholesaleAccountId } }),
    db.targetChainMembership.count({ where: { wholesaleAccountId } }),
  ]);

  return counts.reduce((total, count) => total + count, 0);
};

const getAccountForMerge = (db: Prisma.TransactionClient | typeof prisma, id: string) =>
  db.wholesaleAccount.findUnique({
    where: { id },
    select: {
      address: true,
      agencyId: true,
      city: true,
      county: true,
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

export async function getWholesaleAccountMergePreview(sourceId: string, targetId: string) {
  const [source, target] = await Promise.all([
    getAccountForMerge(prisma, sourceId),
    getAccountForMerge(prisma, targetId),
  ]);

  if (!source) throw new WholesaleMergeError('invalid-source', 'The manual account no longer exists.');
  if (!target) throw new WholesaleMergeError('invalid-target', 'The official account no longer exists.');
  if (sourceId === targetId) throw new WholesaleMergeError('same-account', 'Choose two different accounts.');
  assertMergeSource(source);
  assertMergeTarget(target);

  const [
    visits,
    worklistItems,
    contacts,
    tags,
    menuPlacements,
    recipeSuggestions,
    sourceTargetRecords,
    targetTargetRecords,
  ] = await Promise.all([
    prisma.loggedVisit.count({ where: { wholesaleAccountId: sourceId } }),
    prisma.worklistItem.count({ where: { wholesaleAccountId: sourceId } }),
    prisma.locationContact.count({ where: { wholesaleAccountId: sourceId } }),
    prisma.locationTag.count({ where: { wholesaleAccountId: sourceId } }),
    prisma.menuPlacement.count({ where: { wholesaleAccountId: sourceId } }),
    prisma.recipeSuggestion.count({ where: { wholesaleAccountId: sourceId } }),
    getTargetRecordCount(prisma, sourceId),
    getTargetRecordCount(prisma, targetId),
  ]);

  const blockers =
    sourceTargetRecords > 0 && targetTargetRecords > 0
      ? ['Both accounts contain target intelligence. Resolve that data before merging.']
      : [];

  return {
    blockers,
    counts: {
      contacts,
      menuPlacements,
      recipeSuggestions,
      tags,
      targetRecords: sourceTargetRecords,
      visits,
      worklistItems,
    },
    destinationFallbacks: getWholesaleMergeDestinationFallbacks(source, target),
    licenseeIds: getWholesaleMergeLicenseeIds(source, target),
    source,
    target,
  };
}

type MergeAccountRecord = NonNullable<Awaited<ReturnType<typeof getAccountForMerge>>>;

function assertMergeSource(
  source: Awaited<ReturnType<typeof getAccountForMerge>>,
): asserts source is MergeAccountRecord {
  if (!source) throw new WholesaleMergeError('invalid-source', 'The manual account no longer exists.');
  if (source.mergedIntoId) {
    throw new WholesaleMergeError('already-merged', 'The manual account was already merged.');
  }
  if (source.officialAccountId) {
    throw new WholesaleMergeError('source-is-official', 'The source must be a non-official account.');
  }
}

function assertMergeTarget(
  target: Awaited<ReturnType<typeof getAccountForMerge>>,
): asserts target is MergeAccountRecord {
  if (!target) throw new WholesaleMergeError('invalid-target', 'The official account no longer exists.');
  if (!isEligibleWholesaleMergeTarget(target)) {
    throw new WholesaleMergeError(
      'target-is-not-official',
      'The destination must be an active account with a real Licensee ID.',
    );
  }
}

export async function mergeWholesaleAccounts({
  mergedByUserId,
  sourceId,
  targetId,
}: {
  mergedByUserId: string;
  sourceId: string;
  targetId: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      const [source, target] = await Promise.all([
        getAccountForMerge(tx, sourceId),
        getAccountForMerge(tx, targetId),
      ]);
      if (sourceId === targetId) {
        throw new WholesaleMergeError('same-account', 'Choose two different accounts.');
      }
      assertMergeSource(source);
      assertMergeTarget(target);

      const [sourceTargetRecords, targetTargetRecords] = await Promise.all([
        getTargetRecordCount(tx, sourceId),
        getTargetRecordCount(tx, targetId),
      ]);
      if (sourceTargetRecords > 0 && targetTargetRecords > 0) {
        throw new WholesaleMergeError(
          'target-has-target-data-conflict',
          'Both accounts contain target intelligence.',
        );
      }

      const targetTagIds = (
        await tx.locationTag.findMany({
          where: { wholesaleAccountId: targetId },
          select: { tagId: true },
        })
      ).map(({ tagId }) => tagId);
      const targetRecipeIds = (
        await tx.recipeSuggestion.findMany({
          where: { wholesaleAccountId: targetId },
          select: { recipeId: true },
        })
      ).map(({ recipeId }) => recipeId);

      if (targetTagIds.length > 0) {
        await tx.locationTag.deleteMany({
          where: { wholesaleAccountId: sourceId, tagId: { in: targetTagIds } },
        });
      }
      if (targetRecipeIds.length > 0) {
        await tx.recipeSuggestion.deleteMany({
          where: { wholesaleAccountId: sourceId, recipeId: { in: targetRecipeIds } },
        });
      }

      await tx.loggedVisit.updateMany({
        where: { wholesaleAccountId: sourceId },
        data: { wholesaleAccountId: targetId },
      });
      await tx.worklistItem.updateMany({
        where: { wholesaleAccountId: sourceId },
        data: { wholesaleAccountId: targetId },
      });
      await tx.locationContact.updateMany({
        where: { wholesaleAccountId: sourceId },
        data: { wholesaleAccountId: targetId },
      });
      await tx.locationTag.updateMany({
        where: { wholesaleAccountId: sourceId },
        data: { wholesaleAccountId: targetId },
      });
      await tx.menuPlacement.updateMany({
        where: { wholesaleAccountId: sourceId },
        data: { wholesaleAccountId: targetId },
      });
      await tx.recipeSuggestion.updateMany({
        where: { wholesaleAccountId: sourceId },
        data: { wholesaleAccountId: targetId },
      });

      if (sourceTargetRecords > 0) {
        await tx.targetAccountProfile.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetAccountScoreHistory.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetAccountMetric.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetPublicResearch.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetSkuOpportunity.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetHeatLossAlert.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetChainMembership.updateMany({
          where: { wholesaleAccountId: sourceId },
          data: { wholesaleAccountId: targetId },
        });
        await tx.targetOwnershipGroup.updateMany({
          where: { bestEntryWholesaleAccountId: sourceId },
          data: { bestEntryWholesaleAccountId: targetId },
        });
      }

      const licenseeIds = getWholesaleMergeLicenseeIds(source, target);
      const sourceLicenseeIds = getWholesaleLicenseeIdValues(source);
      const destinationFallbacks = getWholesaleMergeDestinationFallbacks(source, target);
      const sourceHasNewerEchoPurchase =
        source.ohlqLastEchoPurchaseDate &&
        (!target.ohlqLastEchoPurchaseDate || source.ohlqLastEchoPurchaseDate > target.ohlqLastEchoPurchaseDate);

      await tx.wholesaleAccount.update({
        where: { id: sourceId },
        data: {
          isActive: false,
          licenseeId: `merged-${sourceId}`,
          mergeSnapshot: {
            address: source.address,
            agencyId: source.agencyId,
            city: source.city,
            county: source.county,
            deliveryDay: source.deliveryDay,
            districtId: source.districtId,
            licenseeIds: sourceLicenseeIds,
            name: source.name,
            officialAccountId: source.officialAccountId,
            ownership: source.ownership,
            phone: source.phone,
            state: source.state,
            zip: source.zip,
          },
          mergedAt: new Date(),
          mergedByUserId,
          mergedIntoId: targetId,
        },
      });
      await tx.wholesaleLicenseeId.deleteMany({ where: { wholesaleAccountId: sourceId } });
      await syncWholesaleAccountLicenseeIds(tx, targetId, licenseeIds);
      await tx.wholesaleAccount.update({
        where: { id: targetId },
        data: {
          ...destinationFallbacks,
          isActive: true,
          ...(sourceHasNewerEchoPurchase
            ? {
                ohlqLastEchoPurchaseBottles: source.ohlqLastEchoPurchaseBottles,
                ohlqLastEchoPurchaseDate: source.ohlqLastEchoPurchaseDate,
                ohlqLastEchoPurchaseItemCode: source.ohlqLastEchoPurchaseItemCode,
                ohlqLastEchoPurchaseItemName: source.ohlqLastEchoPurchaseItemName,
                ohlqLastEchoPurchaseUpdatedAt: source.ohlqLastEchoPurchaseUpdatedAt,
              }
            : {}),
        },
      });

      return { sourceId, targetId };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
