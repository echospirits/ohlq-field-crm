import { AccountType, type Account, type Prisma } from '@prisma/client';

export const normalizeWholesaleLicenseeId = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
};

type OfficialWholesaleSource = Pick<
  Account,
  | 'address'
  | 'agencyRefId'
  | 'city'
  | 'county'
  | 'districtId'
  | 'id'
  | 'licenseeId'
  | 'name'
  | 'ownership'
  | 'phone'
  | 'state'
  | 'zip'
>;

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
