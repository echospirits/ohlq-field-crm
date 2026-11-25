import type { Prisma } from '@prisma/client';
import { accountStateValues } from './stateOptions';
import { normalizeUsState, US_STATES } from './usStates';

type AddressFilter = Partial<Record<'address' | 'city' | 'county' | 'zip', Prisma.StringNullableFilter>> & {
  state?: Prisma.StringNullableFilter | '' | null;
};
type AddressClause = AddressFilter & { AND?: Array<{ OR: AddressFilter[] }> };

const postalCode = /^\d{5}(?:-\d{4})?$/;
const multiWordStateAtEnd = new RegExp(
  `\\b(?:${US_STATES.map(({ name }) => name).filter((name) => name.includes(' ')).join('|')})\\b(?=(?:[\\s,]+\\d{5}(?:-\\d{4})?)?[\\s,]*$)`,
  'i',
);

function addressFields(term: string): AddressFilter[] {
  const contains = { contains: term, mode: 'insensitive' } as const;
  const state = normalizeUsState(term);
  return [
    { address: contains },
    { city: contains },
    { county: contains },
    { state: { in: state ? accountStateValues([state]) : [term], mode: 'insensitive' } },
    ...(state === 'OH' ? [{ state: null }, { state: '' }] : []),
    { zip: contains },
  ];
}

export function accountAddressSearchClauses(query: string): AddressClause[] {
  const search = query.trim();
  if (!search) return [];

  const clauses: AddressClause[] = addressFields(search);
  const terms = search
    .replace(multiWordStateAtEnd, (name) => normalizeUsState(name) ?? name)
    .split(/[\s,]+/)
    .filter(Boolean);
  if (terms.length === 1 && terms[0] !== search) {
    clauses.push(...addressFields(terms[0]));
  } else if (terms.length > 1 && terms.length <= 12) {
    // A pasted address can span several columns. Keep the whole phrase match
    // and also allow each term to appear in a different address field.
    clauses.push({
      AND: terms.map((term, index) => ({
        OR: index === terms.length - 1 && postalCode.test(term)
          ? [{ zip: { startsWith: term } }]
          : addressFields(term),
      })),
    });
  }
  return clauses;
}
