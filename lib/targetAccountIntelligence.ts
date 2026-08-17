import {
  AccountType,
  AlertStatus,
  TargetOpportunityStatus,
  TargetImportStatus,
  WorklistStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from './prisma';
import {
  DEFAULT_TARGET_MODEL_PERIOD,
  DEFAULT_TARGET_MODEL_VERSION,
  buildHeatLossRules,
  buildScoreExplanation,
  buildTargetRecommendation,
  parseTargetAccountWorkbook,
  type ParsedTargetWorkbook,
  type TargetAccountImportRow,
} from './targetAccountWorkbook';
import {
  getWholesaleLicenseeIdCreateData,
  getWholesaleLicenseeIdLookupWhere,
  getWholesaleLicenseeIdValues,
  isGeneratedWholesaleLicenseeId,
  normalizeWholesaleLicenseeId,
  syncWholesaleAccountLicenseeIds,
} from './wholesaleAccounts';

type TargetDb = PrismaClient | Prisma.TransactionClient;

type ImportTargetWorkbookOptions = {
  buffer: Buffer;
  db?: PrismaClient;
  dryRun?: boolean;
  filename: string;
  importedByUserId?: string | null;
  modelVersion?: string;
};

type TargetImportStats = {
  chainRows: number;
  failedRows: number;
  insertedRows: number;
  metricRows: number;
  opportunityRows: number;
  scoreRows: number;
  skippedRows: number;
  updatedRows: number;
};

const activeWorklistWhere = {
  status: { notIn: [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED] },
};

const toDecimal = (value: number | null | undefined) => (value === null || value === undefined ? undefined : value);

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const hasBlockingWorkbookProblems = (parsed: ParsedTargetWorkbook) =>
  parsed.mappings.some((mapping) => mapping.missingRequired.length > 0);

const buildComponentScores = (row: TargetAccountImportRow) => ({
  categoryWhitespacePercent: row.categoryWhitespacePercent,
  consistencyScore: row.consistencyScore,
  etohioVolumePercentile: row.existingBuyer ? row.etohioVolume9L : null,
  fitVolumePercentile: row.fitVolumePercentile,
  ohioCraftAffinityScore: row.ohioCraftAffinityScore,
  ohioCraftVolumePercentile: row.ohioCraftVolumePercentile,
  priceFitPercent: row.priceFitPercent,
  totalVolumePercentile: row.totalVolumePercentile,
});

const getPrimaryScore = (row: TargetAccountImportRow) =>
  row.existingBuyer ? row.expansionScore ?? row.blendedScore ?? row.dataScore : row.blendedScore ?? row.dataScore;

const upsertOwnershipGroup = async ({
  name,
  sourceImportId,
  tx,
}: {
  name: string | null;
  sourceImportId: string;
  tx: TargetDb;
}) => {
  if (!name) return null;

  return tx.targetOwnershipGroup.upsert({
    where: { name },
    create: {
      name,
      parentOrganization: name,
      sourceImportId,
    },
    update: {
      parentOrganization: name,
      sourceImportId,
    },
    select: { id: true },
  });
};

const upsertWholesaleAccount = async ({
  importedByUserId,
  row,
  tx,
}: {
  importedByUserId?: string | null;
  row: TargetAccountImportRow;
  tx: TargetDb;
}) => {
  const existing = await tx.wholesaleAccount.findFirst({
    where: getWholesaleLicenseeIdLookupWhere(row.permitNumber),
    select: {
      address: true,
      agencyId: true,
      city: true,
      county: true,
      id: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
      name: true,
      officialAccountId: true,
      ownership: true,
      phone: true,
      state: true,
      zip: true,
    },
  });
  const officialAccount = await tx.account.findFirst({
    where: {
      licenseeId: { equals: row.permitNumber, mode: 'insensitive' },
      type: AccountType.BAR_RESTAURANT,
    },
    select: { agencyRefId: true, id: true },
  });

  if (!existing) {
    const created = await tx.wholesaleAccount.create({
      data: {
        licenseeId: row.permitNumber,
        licenseeIds: { create: getWholesaleLicenseeIdCreateData([row.permitNumber]) },
        officialAccountId: officialAccount?.id,
        isActive: true,
        name: row.accountName,
        agencyId: officialAccount?.agencyRefId,
        address: row.address,
        city: row.city,
        ownership: row.ownership,
        zip: row.zip,
        createdByUserId: importedByUserId ?? undefined,
      },
      select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } },
    });

    return { account: created, created: true };
  }

  const existingIds = getWholesaleLicenseeIdValues(existing);
  const primaryLicenseeId =
    isGeneratedWholesaleLicenseeId(existing.licenseeId) || !normalizeWholesaleLicenseeId(existing.licenseeId)
      ? row.permitNumber
      : existing.licenseeId;
  const updateData = {
    officialAccountId: existing.officialAccountId ?? officialAccount?.id,
    isActive: true,
    licenseeId: primaryLicenseeId,
    name: existing.name || row.accountName,
    agencyId: existing.agencyId ?? officialAccount?.agencyRefId,
    address: existing.address ?? row.address,
    city: existing.city ?? row.city,
    ownership: existing.ownership ?? row.ownership,
    zip: existing.zip ?? row.zip,
  };
  const updated = await tx.wholesaleAccount.update({
    where: { id: existing.id },
    data: updateData,
    select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } },
  });
  await syncWholesaleAccountLicenseeIds(tx, existing.id, [primaryLicenseeId, row.permitNumber, ...existingIds]);

  return { account: updated, created: false };
};

const upsertTargetRowsForAccount = async ({
  importId,
  modelVersion,
  portfolioSkus,
  row,
  tx,
  wholesaleAccountId,
}: {
  importId: string;
  modelVersion: string;
  portfolioSkus: ParsedTargetWorkbook['portfolioSkus'];
  row: TargetAccountImportRow;
  tx: TargetDb;
  wholesaleAccountId: string;
}) => {
  const ownershipGroup = await upsertOwnershipGroup({
    name: row.ownership,
    sourceImportId: importId,
    tx,
  });
  const recommendation = buildTargetRecommendation(row, portfolioSkus);
  const explanation = buildScoreExplanation(row);

  await tx.targetAccountProfile.upsert({
    where: { wholesaleAccountId },
    create: {
      wholesaleAccountId,
      ownershipGroupId: ownershipGroup?.id,
      sourceImportId: importId,
      ohlqIdentifier: row.permitNumber,
      accountType: row.accountType,
      researchStatus: row.researchStatus,
      currentPriorityTier: row.priorityTier,
      currentScore: toDecimal(getPrimaryScore(row)),
      currentRank: row.baselineRank,
      primaryOpportunity: recommendation.category,
      recommendedSku: null,
      recommendedNextAction: recommendation.recommendedNextAction,
      reason: explanation,
      existingBuyer: row.existingBuyer,
      currentEtohioVolume9L: row.etohioVolume9L,
      currentEtohioCategories: asJson(row.currentEtohioCategories),
      missingCategories: asJson(row.missingCategories),
      strongestNextCategory: recommendation.category,
      expansionScore: toDecimal(row.expansionScore),
      lastScoredAt: DEFAULT_TARGET_MODEL_PERIOD.scoringDate,
    },
    update: {
      ownershipGroupId: ownershipGroup?.id,
      sourceImportId: importId,
      ohlqIdentifier: row.permitNumber,
      accountType: row.accountType,
      researchStatus: row.researchStatus,
      currentPriorityTier: row.priorityTier,
      currentScore: toDecimal(getPrimaryScore(row)),
      currentRank: row.baselineRank,
      primaryOpportunity: recommendation.category,
      recommendedSku: null,
      recommendedNextAction: recommendation.recommendedNextAction,
      reason: explanation,
      existingBuyer: row.existingBuyer,
      currentEtohioVolume9L: row.etohioVolume9L,
      currentEtohioCategories: asJson(row.currentEtohioCategories),
      missingCategories: asJson(row.missingCategories),
      strongestNextCategory: recommendation.category,
      expansionScore: toDecimal(row.expansionScore),
      lastScoredAt: DEFAULT_TARGET_MODEL_PERIOD.scoringDate,
    },
  });

  await tx.targetAccountScoreHistory.upsert({
    where: {
      wholesaleAccountId_scoringDate_modelVersion_sourceRowHash: {
        wholesaleAccountId,
        scoringDate: DEFAULT_TARGET_MODEL_PERIOD.scoringDate,
        modelVersion,
        sourceRowHash: row.sourceRowHash,
      },
    },
    create: {
      wholesaleAccountId,
      sourceImportId: importId,
      scoringDate: DEFAULT_TARGET_MODEL_PERIOD.scoringDate,
      dataScore: toDecimal(row.dataScore),
      publicFitScore: toDecimal(row.publicFitScore),
      blendedScore: toDecimal(row.blendedScore),
      priorityTier: row.priorityTier,
      baselineRank: row.baselineRank,
      momentumScore: toDecimal(row.momentumScore),
      expansionScore: toDecimal(row.expansionScore),
      componentScores: asJson(buildComponentScores(row)),
      explanation,
      modelVersion,
      sourceRowHash: row.sourceRowHash,
    },
    update: {
      sourceImportId: importId,
      dataScore: toDecimal(row.dataScore),
      publicFitScore: toDecimal(row.publicFitScore),
      blendedScore: toDecimal(row.blendedScore),
      priorityTier: row.priorityTier,
      baselineRank: row.baselineRank,
      momentumScore: toDecimal(row.momentumScore),
      expansionScore: toDecimal(row.expansionScore),
      componentScores: asJson(buildComponentScores(row)),
      explanation,
    },
  });

  await tx.targetAccountMetric.upsert({
    where: {
      wholesaleAccountId_periodStart_periodEnd_modelVersion: {
        wholesaleAccountId,
        periodStart: DEFAULT_TARGET_MODEL_PERIOD.start,
        periodEnd: DEFAULT_TARGET_MODEL_PERIOD.end,
        modelVersion,
      },
    },
    create: {
      wholesaleAccountId,
      sourceImportId: importId,
      periodStart: DEFAULT_TARGET_MODEL_PERIOD.start,
      periodEnd: DEFAULT_TARGET_MODEL_PERIOD.end,
      modelVersion,
      total9LCases: row.total9LCases,
      avgMonthly9L: row.avgMonthly9L,
      monthsActive: row.monthsActive,
      americanWhiskey9L: row.whiskey9L,
      rum9L: row.rum9L,
      vodka9L: row.vodka9L,
      cordial9L: row.cordial9L,
      priceFit9L: row.priceFit9L,
      priceFitPercent: row.priceFitPercent,
      portfolioPriceMedian: toDecimal(row.portfolioPriceMedian),
      premiumBottleShare: row.premiumBottleSharePercent,
      ohioCraft9L: row.otherOhioCraft9L,
      ohioCraftAffinity: toDecimal(row.ohioCraftAffinityScore),
      purchaseConsistency: toDecimal(row.consistencyScore),
      momentumScore: toDecimal(row.momentumScore),
      etohioVolume9L: row.etohioVolume9L,
    },
    update: {
      sourceImportId: importId,
      total9LCases: row.total9LCases,
      avgMonthly9L: row.avgMonthly9L,
      monthsActive: row.monthsActive,
      americanWhiskey9L: row.whiskey9L,
      rum9L: row.rum9L,
      vodka9L: row.vodka9L,
      cordial9L: row.cordial9L,
      priceFit9L: row.priceFit9L,
      priceFitPercent: row.priceFitPercent,
      portfolioPriceMedian: toDecimal(row.portfolioPriceMedian),
      premiumBottleShare: row.premiumBottleSharePercent,
      ohioCraft9L: row.otherOhioCraft9L,
      ohioCraftAffinity: toDecimal(row.ohioCraftAffinityScore),
      purchaseConsistency: toDecimal(row.consistencyScore),
      momentumScore: toDecimal(row.momentumScore),
      etohioVolume9L: row.etohioVolume9L,
    },
  });

  await tx.targetPublicResearch.upsert({
    where: { wholesaleAccountId },
    create: {
      wholesaleAccountId,
      sourceImportId: importId,
      researchStatus: row.researchStatus,
      patioOutdoor: row.patioOutdoor,
      cocktailProgram: row.cocktailFocus,
      websiteUrl: row.websiteUrl,
      cocktailMenuUrl: row.cocktailMenuUrl,
      localBrandsOnMenu: asJson(row.localBrandsOnMenu),
      googleRating: toDecimal(row.googleRating),
      googleReviewCount: row.googleReviewCount,
      yelpRating: toDecimal(row.yelpRating),
      yelpReviewCount: row.yelpReviewCount,
      isNationalChain: row.isNationalChain,
      events: row.eventsGroups,
      popularitySignal: row.popularitySignal,
      notes: row.researchNotes,
      sourceUrls: asJson(row.sourceUrls),
      completedAt: /researched/i.test(row.researchStatus ?? '') && !/not\s+researched|needs|pending|incomplete|queue/i.test(row.researchStatus ?? '') ? DEFAULT_TARGET_MODEL_PERIOD.scoringDate : null,
    },
    update: {
      sourceImportId: importId,
      researchStatus: row.researchStatus,
      patioOutdoor: row.patioOutdoor,
      cocktailProgram: row.cocktailFocus,
      websiteUrl: row.websiteUrl,
      cocktailMenuUrl: row.cocktailMenuUrl,
      localBrandsOnMenu: asJson(row.localBrandsOnMenu),
      googleRating: toDecimal(row.googleRating),
      googleReviewCount: row.googleReviewCount,
      yelpRating: toDecimal(row.yelpRating),
      yelpReviewCount: row.yelpReviewCount,
      isNationalChain: row.isNationalChain,
      events: row.eventsGroups,
      popularitySignal: row.popularitySignal,
      notes: row.researchNotes,
      sourceUrls: asJson(row.sourceUrls),
      completedAt: /researched/i.test(row.researchStatus ?? '') && !/not\s+researched|needs|pending|incomplete|queue/i.test(row.researchStatus ?? '') ? DEFAULT_TARGET_MODEL_PERIOD.scoringDate : null,
    },
  });

  await tx.targetSkuOpportunity.upsert({
    where: {
      wholesaleAccountId_productName_opportunityType_modelVersion: {
        wholesaleAccountId,
        productName: recommendation.productName,
        opportunityType: recommendation.opportunityType,
        modelVersion,
      },
    },
    create: {
      wholesaleAccountId,
      sourceImportId: importId,
      productName: recommendation.productName,
      itemCode: recommendation.itemCode,
      category: recommendation.category,
      opportunityType: recommendation.opportunityType,
      score: recommendation.score,
      confidence: recommendation.confidence,
      supportingReasons: asJson(recommendation.reasons),
      placementStatus: row.existingBuyer ? 'PLACED' : 'NOT_PLACED',
      currentCategoryVolume9L: recommendation.currentCategoryVolume9L,
      estimatedMonthlyPotential: recommendation.estimatedMonthlyPotential,
      recommendedNextAction: recommendation.recommendedNextAction,
      status: TargetOpportunityStatus.OPEN,
      modelVersion,
      sourceRowHash: row.sourceRowHash,
    },
    update: {
      sourceImportId: importId,
      itemCode: recommendation.itemCode,
      category: recommendation.category,
      score: recommendation.score,
      confidence: recommendation.confidence,
      supportingReasons: asJson(recommendation.reasons),
      currentCategoryVolume9L: recommendation.currentCategoryVolume9L,
      estimatedMonthlyPotential: recommendation.estimatedMonthlyPotential,
      recommendedNextAction: recommendation.recommendedNextAction,
      sourceRowHash: row.sourceRowHash,
    },
  });

  const heatAlerts = buildHeatLossRules({
    hasActiveOpportunity: false,
    hasNextAction: Boolean(recommendation.recommendedNextAction),
    row,
  });

  for (const alert of heatAlerts) {
    await tx.targetHeatLossAlert.upsert({
      where: {
        wholesaleAccountId_type: {
          wholesaleAccountId,
          type: alert.type,
        },
      },
      create: {
        wholesaleAccountId,
        sourceImportId: importId,
        type: alert.type,
        title: alert.title,
        detail: alert.detail,
        severity: alert.severity,
        status: AlertStatus.OPEN,
      },
      update: {
        sourceImportId: importId,
        title: alert.title,
        detail: alert.detail,
        severity: alert.severity,
        status: AlertStatus.OPEN,
      },
    });
  }

  return { recommendation };
};

export const importTargetAccountWorkbook = async ({
  buffer,
  db = prisma,
  dryRun = false,
  filename,
  importedByUserId = null,
  modelVersion = DEFAULT_TARGET_MODEL_VERSION,
}: ImportTargetWorkbookOptions) => {
  const parsed = await parseTargetAccountWorkbook(buffer);
  const blockingProblems = hasBlockingWorkbookProblems(parsed);
  const status = dryRun
    ? TargetImportStatus.DRY_RUN
    : blockingProblems
      ? TargetImportStatus.FAILED
      : TargetImportStatus.COMPLETED;
  const initialStatus = status === TargetImportStatus.COMPLETED ? TargetImportStatus.FAILED : status;
  const importRecord = await db.targetModelImport.create({
    data: {
      sourceFilename: filename,
      sourceWorkbookHash: parsed.sourceWorkbookHash,
      modelVersion,
      status: initialStatus,
      importedByUserId,
      committedAt: null,
      accountRows: parsed.accountRows.length,
      scoreRows: parsed.accountRows.length,
      metricRows: parsed.accountRows.length,
      opportunityRows: parsed.accountRows.length,
      chainRows: parsed.chainRows.length,
      failedRows: parsed.failedRows.length,
      warnings: asJson(parsed.warnings),
      failedRowDetails: asJson(parsed.failedRows),
      sheetMappings: asJson(parsed.mappings),
      workbookSummary: asJson(parsed.summary),
    },
  });

  const stats: TargetImportStats = {
    chainRows: parsed.chainRows.length,
    failedRows: parsed.failedRows.length,
    insertedRows: 0,
    metricRows: parsed.accountRows.length,
    opportunityRows: parsed.accountRows.length,
    scoreRows: parsed.accountRows.length,
    skippedRows: blockingProblems ? parsed.accountRows.length : 0,
    updatedRows: 0,
  };

  if (dryRun || blockingProblems) {
    return {
      importId: importRecord.id,
      parsed,
      stats,
      status,
    };
  }

  const accountByPermit = new Map<string, string>();

  try {
    await db.$transaction(
      async (tx) => {
        for (const chain of parsed.chainRows) {
          await tx.targetOwnershipGroup.upsert({
            where: { name: chain.name },
            create: {
              name: chain.name,
              parentOrganization: chain.name,
              sourceImportId: importRecord.id,
              totalLocations: chain.totalLocations,
              unservedLocations: chain.unservedLocations,
              currentEtohioLocations: chain.currentEtohioLocations,
              servedLocations: Math.max(chain.totalLocations - chain.unservedLocations, 0),
              aggregateVolume9L: chain.aggregateVolume9L,
              currentEtohioVolume9L: chain.currentEtohioVolume9L,
              opportunityScore: toDecimal(chain.chainLeverageScore),
              strategicNote: chain.strategicNote,
              suggestedRolloutSequence: asJson(chain.locations),
            },
            update: {
              sourceImportId: importRecord.id,
              totalLocations: chain.totalLocations,
              unservedLocations: chain.unservedLocations,
              currentEtohioLocations: chain.currentEtohioLocations,
              servedLocations: Math.max(chain.totalLocations - chain.unservedLocations, 0),
              aggregateVolume9L: chain.aggregateVolume9L,
              currentEtohioVolume9L: chain.currentEtohioVolume9L,
              opportunityScore: toDecimal(chain.chainLeverageScore),
              strategicNote: chain.strategicNote,
              suggestedRolloutSequence: asJson(chain.locations),
            },
          });
        }
      },
      { maxWait: 30000, timeout: 60000 },
    );

    for (const row of parsed.accountRows) {
      const { accountId, created } = await db.$transaction(
        async (tx) => {
          const { account, created } = await upsertWholesaleAccount({
            importedByUserId,
            row,
            tx,
          });

          await upsertTargetRowsForAccount({
            importId: importRecord.id,
            modelVersion,
            portfolioSkus: parsed.portfolioSkus,
            row,
            tx,
            wholesaleAccountId: account.id,
          });

          return { accountId: account.id, created };
        },
        { maxWait: 30000, timeout: 60000 },
      );

      if (created) {
        stats.insertedRows += 1;
      } else {
        stats.updatedRows += 1;
      }
      accountByPermit.set(row.permitNumber, accountId);
    }

    const ownershipNames = Array.from(new Set(parsed.accountRows.map((row) => row.ownership).filter(Boolean) as string[]));
    const groups = await db.targetOwnershipGroup.findMany({
      where: { name: { in: ownershipNames } },
      select: { id: true, name: true },
    });
    const groupByName = new Map(groups.map((group) => [group.name, group.id]));

    for (const row of parsed.accountRows) {
      const ownershipGroupId = row.ownership ? groupByName.get(row.ownership) : null;
      const wholesaleAccountId = accountByPermit.get(row.permitNumber);

      if (ownershipGroupId && wholesaleAccountId) {
        await db.targetChainMembership.upsert({
          where: {
            ownershipGroupId_wholesaleAccountId: {
              ownershipGroupId,
              wholesaleAccountId,
            },
          },
          create: {
            ownershipGroupId,
            wholesaleAccountId,
            isServed: row.existingBuyer,
            sequenceRank: row.baselineRank,
          },
          update: {
            isServed: row.existingBuyer,
            sequenceRank: row.baselineRank,
          },
        });
      }
    }

    await db.targetModelImport.update({
      where: { id: importRecord.id },
      data: {
        committedAt: new Date(),
        failedRows: stats.failedRows,
        insertedRows: stats.insertedRows,
        skippedRows: stats.skippedRows,
        status,
        updatedRows: stats.updatedRows,
      },
    });
  } catch (error) {
    await db.targetModelImport.update({
      where: { id: importRecord.id },
      data: {
        committedAt: null,
        failedRows: stats.failedRows,
        insertedRows: stats.insertedRows,
        skippedRows: Math.max(parsed.accountRows.length - stats.insertedRows - stats.updatedRows, stats.skippedRows),
        status: TargetImportStatus.FAILED,
        updatedRows: stats.updatedRows,
      },
    });
    throw error;
  }

  return {
    importId: importRecord.id,
    parsed,
    stats,
    status,
  };
};

export const getTargetAccountBriefing = async ({
  db = prisma,
  wholesaleAccountId,
}: {
  db?: PrismaClient;
  wholesaleAccountId: string;
}) => {
  const account = await db.wholesaleAccount.findUnique({
    where: { id: wholesaleAccountId },
    include: {
      targetProfile: {
        include: {
          ownershipGroup: true,
        },
      },
      targetMetrics: {
        orderBy: { periodEnd: 'desc' },
        take: 1,
      },
      targetPublicResearch: true,
      targetScores: {
        orderBy: { scoringDate: 'desc' },
        take: 2,
      },
      targetSkuOpportunities: {
        where: { status: { in: [TargetOpportunityStatus.OPEN, TargetOpportunityStatus.IN_PROGRESS] } },
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
      },
    },
  });

  if (!account) return null;

  const [recentActivities, openWorklistItems, menuPlacements] = await Promise.all([
    db.loggedVisit.findMany({
      where: { wholesaleAccountId, locationType: 'wholesale' },
      orderBy: { visitAt: 'desc' },
      take: 5,
    }),
    db.worklistItem.findMany({
      where: {
        wholesaleAccountId,
        ...activeWorklistWhere,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    }),
    db.menuPlacement.findMany({
      where: { wholesaleAccountId },
      orderBy: [{ updatedAt: 'desc' }],
      take: 10,
    }),
  ]);

  const profile = account.targetProfile;
  const primaryOpportunity = account.targetSkuOpportunities[0];

  return {
    accountSummary: {
      address: [account.address, account.city, account.state, account.zip].filter(Boolean).join(', '),
      city: account.city,
      licenseeId: account.licenseeId,
      name: account.name,
      ownershipGroup: profile?.ownershipGroup?.name ?? account.ownership,
    },
    categoryPerformance: account.targetMetrics[0] ?? null,
    currentPlacements: menuPlacements,
    knownObjections: [],
    nextAction: profile?.recommendedNextAction ?? openWorklistItems[0]?.title ?? null,
    openOpportunities: account.targetSkuOpportunities,
    recentActivities,
    opportunityFocus: profile?.primaryOpportunity ?? primaryOpportunity?.category ?? null,
    recommendedSku: null,
    relationshipHistory: {
      recentActivities,
      worklistItems: openWorklistItems,
    },
    researchNotes: account.targetPublicResearch,
    score: {
      current: profile?.currentScore ?? null,
      explanation: profile?.reason ?? null,
      history: account.targetScores,
      rank: profile?.currentRank ?? null,
      tier: profile?.currentPriorityTier ?? null,
    },
    supportingEvidence: primaryOpportunity?.supportingReasons ?? [],
    whyItMatters: profile?.reason ?? null,
  };
};
