import type { Prisma } from '@prisma/client';

export const OPPORTUNITY_TERRITORIES = [
  { slug: 'central-ohio', label: 'Central Ohio', shortLabel: 'Central', counties: ['Delaware', 'Fairfield', 'Franklin', 'Licking', 'Madison', 'Pickaway', 'Union'] },
  { slug: 'cleveland', label: 'Cleveland area', shortLabel: 'Cleveland', counties: ['Cuyahoga', 'Geauga', 'Lake', 'Lorain', 'Medina'] },
  { slug: 'cincinnati', label: 'Cincinnati area', shortLabel: 'Cincinnati', counties: ['Butler', 'Clermont', 'Hamilton', 'Warren'] },
  { slug: 'dayton', label: 'Dayton area', shortLabel: 'Dayton', counties: ['Champaign', 'Clark', 'Darke', 'Greene', 'Miami', 'Montgomery', 'Preble'] },
  { slug: 'akron-canton', label: 'Akron/Canton area', shortLabel: 'Akron/Canton', counties: ['Portage', 'Stark', 'Summit', 'Wayne'] },
  { slug: 'toledo', label: 'Toledo area', shortLabel: 'Toledo', counties: ['Erie', 'Fulton', 'Henry', 'Lucas', 'Ottawa', 'Sandusky', 'Wood'] },
  { slug: 'youngstown', label: 'Youngstown area', shortLabel: 'Youngstown', counties: ['Columbiana', 'Mahoning', 'Trumbull'] },
  { slug: 'other-ohio', label: 'Other Ohio', shortLabel: 'Other Ohio', counties: null },
] as const;

export type OpportunityTerritorySlug = typeof OPPORTUNITY_TERRITORIES[number]['slug'];

const knownCountyNames = OPPORTUNITY_TERRITORIES.flatMap((territory) => territory.counties ?? []);
const territoryByCounty = new Map(
  OPPORTUNITY_TERRITORIES.flatMap((territory) => (territory.counties ?? []).map((county) => [county.toUpperCase(), territory.slug] as const)),
);

export const isOpportunityTerritorySlug = (value: string | undefined): value is OpportunityTerritorySlug =>
  Boolean(value && OPPORTUNITY_TERRITORIES.some((territory) => territory.slug === value));

export const opportunityTerritoryForCounty = (county: string | null | undefined): OpportunityTerritorySlug =>
  territoryByCounty.get((county ?? '').trim().toUpperCase()) ?? 'other-ohio';

export const opportunityTerritoryLabel = (slug: OpportunityTerritorySlug) =>
  OPPORTUNITY_TERRITORIES.find((territory) => territory.slug === slug)?.label ?? 'Other Ohio';

export function opportunityTerritoryAccountWhere(slug: OpportunityTerritorySlug): Prisma.WholesaleAccountWhereInput {
  const territory = OPPORTUNITY_TERRITORIES.find((item) => item.slug === slug)!;
  const ohio: Prisma.WholesaleAccountWhereInput = { OR: [{ state: { in: ['OH', 'Ohio'], mode: 'insensitive' } }, { state: null }, { state: '' }] };
  return { AND: [ohio, territory.counties
    ? { county: { in: [...territory.counties], mode: 'insensitive' } }
    : { OR: [{ county: null }, { county: { notIn: [...knownCountyNames], mode: 'insensitive' } }] },
  ] };
}

export function territoryCoverageDeficits(accounts: Array<{ county: string | null; targetPublicResearch: { lastRefreshedAt: Date | null } | null }>) {
  const totals = new Map<OpportunityTerritorySlug, number>();
  const researched = new Map<OpportunityTerritorySlug, number>();
  for (const account of accounts) {
    const territory = opportunityTerritoryForCounty(account.county);
    totals.set(territory, (totals.get(territory) ?? 0) + 1);
    if (account.targetPublicResearch?.lastRefreshedAt) researched.set(territory, (researched.get(territory) ?? 0) + 1);
  }
  const coverage = (territory: OpportunityTerritorySlug) => (researched.get(territory) ?? 0) / Math.max(1, totals.get(territory) ?? 0);
  const centralCoverage = coverage('central-ohio');
  return new Map(OPPORTUNITY_TERRITORIES.map((territory) => [
    territory.slug,
    territory.slug === 'central-ohio' ? 0 : Math.max(0, centralCoverage - coverage(territory.slug)),
  ]));
}
