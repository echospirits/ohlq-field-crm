import { AccountType, type Account, type Prisma } from '@prisma/client';

export const normalizeWholesaleLicenseeId = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
};

type WholesaleLicenseeIdValue = string | { licenseeId: string | null } | null | undefined;

type WholesaleLicenseeIdWriter = {
  wholesaleLicenseeId: {
    deleteMany(args: Prisma.WholesaleLicenseeIdDeleteManyArgs): Promise<Prisma.BatchPayload>;
    updateMany(args: Prisma.WholesaleLicenseeIdUpdateManyArgs): Promise<Prisma.BatchPayload>;
    upsert(args: Prisma.WholesaleLicenseeIdUpsertArgs): Promise<unknown>;
  };
};

export const parseWholesaleLicenseeIds = (value: string | null | undefined) => {
  const ids = String(value ?? '')
    .split(/[\n,;]+/)
    .map((id) => normalizeWholesaleLicenseeId(id))
    .filter(Boolean) as string[];

  return Array.from(new Set(ids));
};

export const getPrimaryWholesaleLicenseeId = (licenseeIds: string[]) => licenseeIds[0] ?? null;

export const isGeneratedWholesaleLicenseeId = (value: string | null | undefined) => {
  const normalized = normalizeWholesaleLicenseeId(value);
  return normalized ? normalized.startsWith('MANUAL-') : false;
};

export const getWholesaleOfficialLookupLicenseeIds = ({
  existingLicenseeId,
  existingLicenseeIds,
  licenseeIds,
}: {
  existingLicenseeId?: string | null;
  existingLicenseeIds?: string[];
  licenseeIds: string[];
}) => {
  const normalizedLicenseeIds = parseWholesaleLicenseeIds(licenseeIds.join('\n'));
  const normalizedExistingLicenseeIds = parseWholesaleLicenseeIds((existingLicenseeIds ?? []).join('\n'));
  const newlyEnteredLicenseeIds =
    normalizedExistingLicenseeIds.length > 0
      ? normalizedLicenseeIds.filter((licenseeId) => !normalizedExistingLicenseeIds.includes(licenseeId))
      : [];

  if (!isGeneratedWholesaleLicenseeId(existingLicenseeId) && !isGeneratedWholesaleLicenseeId(normalizedLicenseeIds[0])) {
    return Array.from(new Set([...newlyEnteredLicenseeIds, ...normalizedLicenseeIds]));
  }

  return Array.from(new Set([
    ...newlyEnteredLicenseeIds,
    ...normalizedLicenseeIds.filter((licenseeId) => !isGeneratedWholesaleLicenseeId(licenseeId)),
    ...normalizedLicenseeIds.filter((licenseeId) => isGeneratedWholesaleLicenseeId(licenseeId)),
  ]));
};

export const wholesaleLicenseeIdListsMatch = (
  leftLicenseeIds: string[],
  rightLicenseeIds: string[],
) => {
  const normalizedLeftLicenseeIds = parseWholesaleLicenseeIds(leftLicenseeIds.join('\n'));
  const normalizedRightLicenseeIds = parseWholesaleLicenseeIds(rightLicenseeIds.join('\n'));

  return (
    normalizedLeftLicenseeIds.length === normalizedRightLicenseeIds.length &&
    normalizedLeftLicenseeIds.every((licenseeId, index) => licenseeId === normalizedRightLicenseeIds[index])
  );
};

export const moveWholesaleLicenseeIdToPrimary = (
  licenseeIds: string[],
  primaryLicenseeId: string | null | undefined,
) => {
  const normalizedPrimaryLicenseeId = normalizeWholesaleLicenseeId(primaryLicenseeId);
  const normalizedLicenseeIds = parseWholesaleLicenseeIds(licenseeIds.join('\n'));

  if (!normalizedPrimaryLicenseeId || !normalizedLicenseeIds.includes(normalizedPrimaryLicenseeId)) {
    return normalizedLicenseeIds;
  }

  return [
    normalizedPrimaryLicenseeId,
    ...normalizedLicenseeIds.filter((licenseeId) => licenseeId !== normalizedPrimaryLicenseeId),
  ];
};

export const getWholesaleLicenseeIdValues = (account: {
  licenseeId?: string | null;
  licenseeIds?: WholesaleLicenseeIdValue[] | null;
}) => {
  const ids = [
    normalizeWholesaleLicenseeId(account.licenseeId),
    ...(account.licenseeIds ?? []).map((value) =>
      normalizeWholesaleLicenseeId(typeof value === 'string' ? value : value?.licenseeId),
    ),
  ].filter(Boolean) as string[];

  return Array.from(new Set(ids));
};

export const formatWholesaleLicenseeIds = (account: {
  licenseeId?: string | null;
  licenseeIds?: WholesaleLicenseeIdValue[] | null;
}) => getWholesaleLicenseeIdValues(account).join(', ');

export const getWholesaleLicenseeIdCreateData = (licenseeIds: string[]) =>
  licenseeIds.map((licenseeId, index) => ({
    isPrimary: index === 0,
    licenseeId,
  }));

const getWholesaleLicenseeIdConditions = (licenseeIds: string[]) =>
  licenseeIds.map((licenseeId) => ({
    licenseeId: { equals: licenseeId, mode: 'insensitive' as const },
  }));

export const getWholesaleLicenseeIdLookupWhere = (licenseeId: string): Prisma.WholesaleAccountWhereInput => ({
  OR: [
    { licenseeId: { equals: licenseeId, mode: 'insensitive' } },
    {
      licenseeIds: {
        some: { licenseeId: { equals: licenseeId, mode: 'insensitive' } },
      },
    },
  ],
});

export const getWholesaleLicenseeIdConflictWhere = (
  licenseeIds: string[],
  excludeWholesaleAccountId?: string,
): Prisma.WholesaleAccountWhereInput => {
  const conditions = getWholesaleLicenseeIdConditions(licenseeIds);

  return {
    ...(excludeWholesaleAccountId ? { id: { not: excludeWholesaleAccountId } } : {}),
    OR: [
      ...conditions,
      {
        licenseeIds: {
          some: { OR: conditions },
        },
      },
    ],
  };
};

export const getWholesaleLicenseeIdTextSearchWhere = (q: string): Prisma.WholesaleAccountWhereInput[] => [
  { licenseeId: { contains: q, mode: 'insensitive' } },
  {
    licenseeIds: {
      some: { licenseeId: { contains: q, mode: 'insensitive' } },
    },
  },
];

export async function syncWholesaleAccountLicenseeIds(
  db: WholesaleLicenseeIdWriter,
  wholesaleAccountId: string,
  licenseeIds: string[],
) {
  const normalizedLicenseeIds = parseWholesaleLicenseeIds(licenseeIds.join('\n'));
  const primaryLicenseeId = getPrimaryWholesaleLicenseeId(normalizedLicenseeIds);

  await db.wholesaleLicenseeId.deleteMany({
    where: {
      wholesaleAccountId,
      licenseeId: { notIn: normalizedLicenseeIds },
    },
  });

  for (const [index, licenseeId] of normalizedLicenseeIds.entries()) {
    await db.wholesaleLicenseeId.upsert({
      where: { licenseeId },
      create: {
        wholesaleAccountId,
        licenseeId,
        isPrimary: index === 0,
      },
      update: {
        isPrimary: index === 0,
      },
    });
  }

  if (primaryLicenseeId) {
    await db.wholesaleLicenseeId.updateMany({
      where: {
        wholesaleAccountId,
        licenseeId: { not: primaryLicenseeId },
      },
      data: { isPrimary: false },
    });
  }
}

export type OfficialWholesaleSource = Pick<
  Account,
  | 'address'
  | 'agencyRefId'
  | 'city'
  | 'county'
  | 'deliveryDay'
  | 'districtId'
  | 'id'
  | 'licenseeId'
  | 'name'
  | 'ownership'
  | 'phone'
  | 'state'
  | 'zip'
>;

export type WholesaleAccountEditableValues = {
  address: string | null;
  agencyId: string | null;
  city: string | null;
  county: string | null;
  deliveryDay: string | null;
  districtId: string | null;
  name: string;
  ownership: string | null;
  phone: string | null;
  state: string;
  zip: string | null;
};

const normalizeEditableValue = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const chooseSubmittedChangeOrOfficialDefault = ({
  existingValue,
  fallback,
  officialValue,
  submittedValue,
}: {
  existingValue: string | null | undefined;
  fallback?: string | null;
  officialValue: string | null | undefined;
  submittedValue: string | null | undefined;
}) => {
  const fallbackValue = normalizeEditableValue(fallback);
  const existing = normalizeEditableValue(existingValue) ?? fallbackValue;
  const submitted = normalizeEditableValue(submittedValue) ?? fallbackValue;
  const official = normalizeEditableValue(officialValue);

  if (submitted && submitted !== existing) {
    return submitted;
  }

  return official ?? submitted ?? existing ?? null;
};

export function getWholesaleEditableValuesFromOfficialAccount(
  officialAccount: OfficialWholesaleSource,
): WholesaleAccountEditableValues {
  return {
    address: officialAccount.address,
    agencyId: officialAccount.agencyRefId,
    city: officialAccount.city,
    county: officialAccount.county,
    deliveryDay: officialAccount.deliveryDay,
    districtId: officialAccount.districtId,
    name: officialAccount.name,
    ownership: officialAccount.ownership,
    phone: officialAccount.phone,
    state: officialAccount.state ?? 'OH',
    zip: officialAccount.zip,
  };
}

export function mergeWholesaleEditableValuesWithOfficialDefaults({
  existingValues,
  officialValues,
  submittedValues,
}: {
  existingValues: WholesaleAccountEditableValues;
  officialValues: WholesaleAccountEditableValues;
  submittedValues: WholesaleAccountEditableValues;
}): WholesaleAccountEditableValues {
  return {
    address: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.address,
      officialValue: officialValues.address,
      submittedValue: submittedValues.address,
    }),
    agencyId: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.agencyId,
      officialValue: officialValues.agencyId,
      submittedValue: submittedValues.agencyId,
    }),
    city: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.city,
      officialValue: officialValues.city,
      submittedValue: submittedValues.city,
    }),
    county: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.county,
      officialValue: officialValues.county,
      submittedValue: submittedValues.county,
    }),
    deliveryDay: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.deliveryDay,
      officialValue: officialValues.deliveryDay,
      submittedValue: submittedValues.deliveryDay,
    }),
    districtId: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.districtId,
      officialValue: officialValues.districtId,
      submittedValue: submittedValues.districtId,
    }),
    name: submittedValues.name,
    ownership: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.ownership,
      officialValue: officialValues.ownership,
      submittedValue: submittedValues.ownership,
    }),
    phone: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.phone,
      officialValue: officialValues.phone,
      submittedValue: submittedValues.phone,
    }),
    state:
      chooseSubmittedChangeOrOfficialDefault({
        existingValue: existingValues.state,
        fallback: 'OH',
        officialValue: officialValues.state,
        submittedValue: submittedValues.state,
      }) ?? 'OH',
    zip: chooseSubmittedChangeOrOfficialDefault({
      existingValue: existingValues.zip,
      officialValue: officialValues.zip,
      submittedValue: submittedValues.zip,
    }),
  };
}

export function getWholesaleCreateDataFromOfficialAccount(
  officialAccount: OfficialWholesaleSource,
  createdByUserId: string,
): Prisma.WholesaleAccountCreateInput {
  const licenseeId = normalizeWholesaleLicenseeId(officialAccount.licenseeId);
  if (!licenseeId) {
    throw new Error('Official wholesale account is missing a Licensee ID.');
  }

  return {
    address: officialAccount.address,
    agencyId: officialAccount.agencyRefId,
    city: officialAccount.city,
    county: officialAccount.county,
    createdByUser: { connect: { id: createdByUserId } },
    deliveryDay: officialAccount.deliveryDay,
    districtId: officialAccount.districtId,
    isActive: true,
    licenseeId,
    licenseeIds: { create: getWholesaleLicenseeIdCreateData([licenseeId]) },
    name: officialAccount.name,
    officialAccount: { connect: { id: officialAccount.id } },
    ownership: officialAccount.ownership,
    phone: officialAccount.phone,
    state: officialAccount.state ?? 'OH',
    zip: officialAccount.zip,
  };
}

export function getLegacyAccountCreateDataFromWholesaleAccount(wholesaleAccount: {
  address: string | null;
  agencyId: string | null;
  city: string | null;
  county: string | null;
  districtId: string | null;
  licenseeId: string;
  name: string;
  ownership: string | null;
  phone: string | null;
  state: string | null;
  zip: string | null;
}): Prisma.AccountCreateInput {
  return {
    address: wholesaleAccount.address,
    agencyRefId: wholesaleAccount.agencyId,
    city: wholesaleAccount.city,
    county: wholesaleAccount.county,
    districtId: wholesaleAccount.districtId,
    licenseeId: wholesaleAccount.licenseeId,
    name: wholesaleAccount.name,
    ownership: wholesaleAccount.ownership,
    phone: wholesaleAccount.phone,
    state: wholesaleAccount.state ?? 'OH',
    type: AccountType.BAR_RESTAURANT,
    zip: wholesaleAccount.zip,
  };
}
