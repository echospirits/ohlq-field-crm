import { AccountType, type Prisma, type PrismaClient } from '@prisma/client';
import { isEchoItem } from './ohlqSalesData';
import {
  areOhlqAddressesSame,
  getOhlqLicenseeMatchKeys,
  normalizeOhlqId,
} from './ohlqWholesaleMatching';
import { prisma } from './prisma';

type EchoPurchaseRow = {
  brand: string;
  permitNumber: string;
  reportDate: Date;
  vendor: string;
  wholesaleBottlesSold: number;
};

type WholesaleAccountCandidate = {
  address: string | null;
  city: string | null;
  id: string;
  licenseeId: string;
  name: string;
  officialAccountId: string | null;
  state: string | null;
  zip: string | null;
};

type OfficialAccountCandidate = {
  address: string | null;
  city: string | null;
  id: string;
  licenseeId: string | null;
  officialWholesale: { id: string } | null;
  state: string | null;
  zip: string | null;
};

export type OhlqWholesalePurchaseStateSyncResult = {
  matchedPermitNumbers: number;
  skippedRows: number;
  unmatchedPermitNumbers: string[];
  updatedAccounts: number;
};

const minimumStemSearchLength = 4;

const hasKeyOverlap = (left: string[], right: string[]) => {
  const leftKeys = new Set(left);
  return right.some((key) => leftKeys.has(key));
};

const getStreetNumber = (address: string | null | undefined) => address?.match(/\d+/)?.[0] ?? null;

const normalizeZip = (value: string | null | undefined) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(0, 5) || null;
};

const getPermitSearchConditions = (permitNumbers: string[]) => {
  const normalizedPermitNumbers = Array.from(new Set(permitNumbers.map(normalizeOhlqId).filter(Boolean) as string[]));
  const matchKeys = Array.from(new Set(normalizedPermitNumbers.flatMap(getOhlqLicenseeMatchKeys)));

  return [
    ...normalizedPermitNumbers.map((permitNumber) => ({
      licenseeId: { equals: permitNumber, mode: 'insensitive' as const },
    })),
    ...matchKeys
      .filter((key) => key.length >= minimumStemSearchLength)
      .map((key) => ({
        licenseeId: { contains: key, mode: 'insensitive' as const },
      })),
  ];
};

const getAddressSearchConditions = (officialAccounts: OfficialAccountCandidate[]): Prisma.WholesaleAccountWhereInput[] => {
  const conditions: Prisma.WholesaleAccountWhereInput[] = [];

  officialAccounts.forEach((account) => {
    const streetNumber = getStreetNumber(account.address);
    if (!streetNumber) return;

    const zip = normalizeZip(account.zip);
    conditions.push({
      address: { contains: streetNumber, mode: 'insensitive' },
      ...(zip
        ? { zip: { startsWith: zip } }
        : account.city
          ? { city: { equals: account.city, mode: 'insensitive' } }
          : {}),
    });
  });

  return conditions;
};

const getItemNameLookup = async (db: PrismaClient, itemCodes: string[]) => {
  if (itemCodes.length === 0) return new Map<string, string>();

  const items = await db.ohlqBrandMasterItem.findMany({
    where: { itemCode: { in: Array.from(new Set(itemCodes)) } },
    select: { itemCode: true, name: true },
  });

  return new Map(items.map((item) => [item.itemCode, item.name]));
};

async function findMatchingWholesaleAccounts({
  db,
  permitNumbers,
}: {
  db: PrismaClient;
  permitNumbers: string[];
}) {
  const permitKeysByNumber = new Map(
    permitNumbers.map((permitNumber) => [permitNumber, getOhlqLicenseeMatchKeys(permitNumber)] as const),
  );
  const targetKeys = new Set(Array.from(permitKeysByNumber.values()).flat());
  const searchConditions = getPermitSearchConditions(permitNumbers);

  if (searchConditions.length === 0) return new Map<string, WholesaleAccountCandidate[]>();

  const [directAccounts, officialAccounts] = await Promise.all([
    db.wholesaleAccount.findMany({
      where: {
        isActive: true,
        OR: searchConditions,
      },
      select: {
        address: true,
        city: true,
        id: true,
        licenseeId: true,
        name: true,
        officialAccountId: true,
        state: true,
        zip: true,
      },
    }),
    db.account.findMany({
      where: {
        type: AccountType.BAR_RESTAURANT,
        OR: searchConditions,
      },
      select: {
        address: true,
        city: true,
        id: true,
        licenseeId: true,
        officialWholesale: { select: { id: true } },
        state: true,
        zip: true,
      },
    }),
  ]);

  const matchingOfficialAccounts = officialAccounts.filter((account) =>
    getOhlqLicenseeMatchKeys(account.licenseeId).some((key) => targetKeys.has(key)),
  );
  const linkedOfficialAccountIds = matchingOfficialAccounts
    .map((account) => account.officialWholesale?.id)
    .filter(Boolean) as string[];
  const addressSearchConditions = getAddressSearchConditions(matchingOfficialAccounts);
  const [linkedOfficialWholesaleAccounts, addressCandidateWholesaleAccounts] = await Promise.all([
    linkedOfficialAccountIds.length > 0
      ? db.wholesaleAccount.findMany({
          where: {
            id: { in: linkedOfficialAccountIds },
            isActive: true,
          },
          select: {
            address: true,
            city: true,
            id: true,
            licenseeId: true,
            name: true,
            officialAccountId: true,
            state: true,
            zip: true,
          },
        })
      : [],
    addressSearchConditions.length > 0
      ? db.wholesaleAccount.findMany({
          where: {
            isActive: true,
            OR: addressSearchConditions,
          },
          select: {
            address: true,
            city: true,
            id: true,
            licenseeId: true,
            name: true,
            officialAccountId: true,
            state: true,
            zip: true,
          },
        })
      : [],
  ]);

  const allAccounts = new Map<string, WholesaleAccountCandidate>();
  [...directAccounts, ...linkedOfficialWholesaleAccounts, ...addressCandidateWholesaleAccounts].forEach((account) => {
    allAccounts.set(account.id, account);
  });

  const accountsByPermitNumber = new Map<string, WholesaleAccountCandidate[]>();
  permitKeysByNumber.forEach((permitKeys, permitNumber) => {
    const matches: WholesaleAccountCandidate[] = [];

    allAccounts.forEach((account) => {
      if (hasKeyOverlap(permitKeys, getOhlqLicenseeMatchKeys(account.licenseeId))) {
        matches.push(account);
        return;
      }

      const matchingOfficial = matchingOfficialAccounts.find(
        (official) =>
          hasKeyOverlap(permitKeys, getOhlqLicenseeMatchKeys(official.licenseeId)) &&
          (official.officialWholesale?.id === account.id || areOhlqAddressesSame(official, account)),
      );

      if (matchingOfficial) {
        matches.push(account);
      }
    });

    accountsByPermitNumber.set(permitNumber, matches);
  });

  return accountsByPermitNumber;
}

export async function syncWholesaleAccountEchoPurchaseState({
  db = prisma,
  rows,
}: {
  db?: PrismaClient;
  rows: EchoPurchaseRow[];
}) {
  const echoRows = rows.filter((row) => isEchoItem(row.vendor, row.brand));
  const permitNumbers = Array.from(new Set(echoRows.map((row) => normalizeOhlqId(row.permitNumber)).filter(Boolean) as string[]));
  const accountsByPermitNumber = await findMatchingWholesaleAccounts({ db, permitNumbers });
  const itemNames = await getItemNameLookup(
    db,
    echoRows.map((row) => row.brand),
  );
  const updates = new Map<
    string,
    {
      bottles: number;
      itemCode: string;
      itemName: string;
      purchaseDate: Date;
    }
  >();
  const matchedPermitNumbers = new Set<string>();
  const unmatchedPermitNumbers = new Set<string>();

  for (const row of echoRows) {
    const permitNumber = normalizeOhlqId(row.permitNumber);
    if (!permitNumber) continue;

    const accounts = accountsByPermitNumber.get(permitNumber) ?? [];
    if (accounts.length === 0) {
      unmatchedPermitNumbers.add(permitNumber);
      continue;
    }

    matchedPermitNumbers.add(permitNumber);
    accounts.forEach((account) => {
      const existing = updates.get(account.id);
      const itemName = itemNames.get(row.brand) ?? 'Name pending';
      const existingTime = existing?.purchaseDate.getTime() ?? -1;
      const rowTime = row.reportDate.getTime();

      if (!existing || rowTime > existingTime) {
        updates.set(account.id, {
          bottles: row.wholesaleBottlesSold,
          itemCode: row.brand,
          itemName,
          purchaseDate: row.reportDate,
        });
        return;
      }

      if (rowTime === existingTime) {
        const totalBottles = existing.bottles + row.wholesaleBottlesSold;
        updates.set(account.id, {
          bottles: totalBottles,
          itemCode: row.wholesaleBottlesSold > existing.bottles ? row.brand : existing.itemCode,
          itemName: row.wholesaleBottlesSold > existing.bottles ? itemName : existing.itemName,
          purchaseDate: existing.purchaseDate,
        });
      }
    });
  }

  let updatedAccounts = 0;
  for (const [accountId, update] of updates) {
    const result = await db.wholesaleAccount.updateMany({
      where: {
        id: accountId,
        OR: [
          { ohlqLastEchoPurchaseDate: null },
          { ohlqLastEchoPurchaseDate: { lte: update.purchaseDate } },
        ],
      },
      data: {
        ohlqLastEchoPurchaseBottles: update.bottles,
        ohlqLastEchoPurchaseDate: update.purchaseDate,
        ohlqLastEchoPurchaseItemCode: update.itemCode,
        ohlqLastEchoPurchaseItemName: update.itemName,
        ohlqLastEchoPurchaseUpdatedAt: new Date(),
      },
    });
    updatedAccounts += result.count;
  }

  return {
    matchedPermitNumbers: matchedPermitNumbers.size,
    skippedRows: rows.length - echoRows.length,
    unmatchedPermitNumbers: Array.from(unmatchedPermitNumbers).sort(),
    updatedAccounts,
  } satisfies OhlqWholesalePurchaseStateSyncResult;
}
