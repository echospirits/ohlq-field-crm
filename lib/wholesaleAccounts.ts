import { AccountType, type Account, type Prisma } from '@prisma/client';

export const normalizeWholesaleLicenseeId = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
};

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
    name:
      chooseSubmittedChangeOrOfficialDefault({
        existingValue: existingValues.name,
        officialValue: officialValues.name,
        submittedValue: submittedValues.name,
      }) ?? submittedValues.name,
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
