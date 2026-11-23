import { normalizeOhlqAddressPart } from './ohlqAddressNormalization';
import { normalizeOhioWholesaleCity, ohioCityKey } from './ohioWholesaleCities';
import { normalizeUsState } from './usStates';

type Location = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

type HouseNumbers =
  | { kind: 'listed'; numbers: string[] }
  | { kind: 'range'; start: number; end: number };

// These are verified postal/municipal labels for the same ZIP. A label
// in one group does not establish equivalence in other ZIPs.
const ohioCityAliases: Readonly<Record<string, readonly string[]>> = {
  '43016': ['COLUMBUS', 'DUBLIN'],
  '43026': ['COLUMBUS', 'HILLIARD'],
  '43128': ['OCTA JEFFERSONVILLE', 'JEFFERSONVILLE'],
  '43440': ['LAKESIDE', 'LAKESIDE MARBLEHEAD'],
  '44067': ['NORTHFIELD', 'NORTHFIELD CENTER', 'NORTHFIELD CENTER TOWNSHIP'],
  '44313': ['FAIRLAWN AKRON', 'FAIRLAWN', 'AKRON'],
  '44512': ['YOUNGSTOWN', 'BOARDMAN', 'BOARDMAN TOWNSHIP'],
  '44515': ['YOUNGSTOWN', 'AUSTINTOWN', 'AUSTINTOWN TOWNSHIP'],
  '44685': ['GREEN UNIONTOWN', 'UNIONTOWN'],
  '44720': ['NOTH CANTON', 'NORTH CANTON', 'CANTON'],
  '45344': ['NEW CARISLE', 'NEW CARLISLE'],
  '45459': ['DAYTON', 'CENTERVILLE'],
};

function cityKey(city: string, ohio: boolean) {
  const key = ohioCityKey(ohio ? normalizeOhioWholesaleCity(city) : city)
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W');
  if (!ohio) return key;
  return key
    .replace(/\bCTR\b/g, 'CENTER')
    .replace(/\bTWP\b/g, 'TOWNSHIP')
    .replace(/\bHGTS\b/g, 'HEIGHTS')
    .replace(/^ST /, 'SAINT ');
}

function citiesMatch(expected: string | null, found: string | null, ohioZip: string | null) {
  if (!expected || !found) return false;
  const expectedKey = cityKey(expected, Boolean(ohioZip));
  if (!expectedKey) return false;
  if (cityKey(found, Boolean(ohioZip)) === expectedKey) return true;
  const aliases = ohioZip ? ohioCityAliases[ohioZip]?.map(city => cityKey(city, true)) : undefined;
  if (!aliases?.includes(expectedKey)) return false;
  // The provider can return locality labels such as "Centerville / Dayton
  // mailing locality". Every listed city must belong to the same ZIP group.
  return found.split('/').every(city =>
    aliases.includes(cityKey(city.trim().replace(/\s+(?:mailing locality|market)$/i, ''), true)),
  );
}

function parseHouseNumbers(prefix: string): HouseNumbers | null {
  const tokens = prefix.toUpperCase().split(/\s*(?:-|&|,|\bAND\b)\s*/);
  if (tokens.some(token => !/^\d{1,8}[A-Z]?$/.test(token) || Number.parseInt(token, 10) === 0)) return null;
  if (!prefix.includes('-')) {
    return { kind: 'listed', numbers: [...new Set(tokens.map(token => token.replace(/^0+/, '')))].sort() };
  }
  // A chain such as 5676-78-80 or mixed range/list is ambiguous.
  if (tokens.length !== 2 || tokens.some(token => !/^\d+$/.test(token))) return null;
  const [first, last] = tokens;
  const start = Number(first);
  const scale = 10 ** last.length;
  const end = last.length < first.length ? Math.floor(start / scale) * scale + Number(last) : Number(last);
  return end > start ? { kind: 'range', start, end } : null;
}

function normalizeStreet(value: string, ohioZip: string | null) {
  let formatted = value
    // OHLQ occasionally concatenates the final street token and a secondary unit.
    .replace(/\b(ST|RD|AVE?|BLVD|DR|LN|HWY|NW|NE|SW|SE)(?=(?:SUITES?|STE|UNIT)\s+[A-Z0-9]+|\d+(?:ST|ND|RD|TH)\s)/gi, '$1 ')
    .replace(/#\s*(?=[a-z0-9])/gi, ' UNIT ')
    .replace(/\b(?:SUITES?|STE|SPACE|SPC)\b/gi, 'UNIT')
    .replace(/\b(?:FLOOR|FLR)\b/gi, 'FL')
    .replace(/\bBASEMENT\b/gi, 'BSMT')
    .replace(/\bMOUNT\b/gi, 'MT')
    .replace(/\bPLAZA\b/gi, 'PLZ')
    .replace(/\bSQUARE\b/gi, 'SQ')
    .replace(/\bTRAIL\b/gi, 'TRL')
    .replace(/\b(NORTH|SOUTH)[ -]?(EAST|WEST)\b/gi, (_match, first: string, second: string) => first[0] + second[0])
    .replace(/\b([NS])[\s.]+([EW])\b/gi, '$1$2')
    .replace(/\bU\.?S\.?\s*(?:(?:HIGHWAY|HWY|ROUTE|RTE)\s*)?-?\s*(?=\d)/gi, 'US ')
    .replace(/\b(?:COUNTY\s+(?:ROAD|RD)|CR)\s*-?\s*(?=\d)/gi, 'CR ')
    .replace(/\b(?:STATE\s+(?:ROUTE|RTE|RT|HIGHWAY|HWY)|ST\.?\s+RT\.?|SR)\s*-?\s*(?=\d)/gi, 'SR ');
  if (ohioZip) {
    formatted = formatted.replace(/\bOH(?:IO)?\s*(?:(?:ROUTE|HIGHWAY)\s*)?-?\s*(?=\d)/gi, 'SR ');
  }
  let street = normalizeOhlqAddressPart(formatted);
  // OHLQ abbreviates Columbus Pike as Columbus PK at these Delaware addresses.
  if (ohioZip === '43015') street = street?.replace(/^COLUMBUS PK(?=$| )/, 'COLUMBUS PIKE') ?? null;
  return street;
}

function parseAddress(address: string | null, ohioZip: string | null) {
  const match = address?.trim().replace(/[‐‑‒–—−]/g, '-')
    .match(/^(\d+[a-z]?(?:\s*(?:[-&,]|\band\b)\s*\d+[a-z]?)*)\s+(\S.*)$/i);
  if (!match || /^(?:[-&,]|\band\b)/i.test(match[2])) return null;
  const numbers = parseHouseNumbers(match[1]);
  const street = normalizeStreet(match[2], ohioZip);
  return numbers && street ? { numbers, street } : null;
}

function houseNumbersMatch(expected: HouseNumbers, found: HouseNumbers, allowOhioPremises: boolean) {
  if (expected.kind === 'range') {
    if (found.kind === 'range') return expected.start === found.start && expected.end === found.end;
    const [number] = found.numbers;
    return allowOhioPremises && found.numbers.length === 1 && /^\d+$/.test(number)
      && Number(number) >= expected.start && Number(number) <= expected.end;
  }
  if (found.kind === 'range') return false;
  const sameList = expected.numbers.join(',') === found.numbers.join(',');
  return sameList || (allowOhioPremises && found.numbers.length === 1 && expected.numbers.includes(found.numbers[0]));
}

const zip5 = (value: string | null) => value?.trim().match(/^(\d{5})(?:-?\d{4})?$/)?.[1];

function ohioStreetKey(street: string) {
  // A patio, ordinary first floor, or first floor plus basement describes the
  // licensed areas of a premises. A suite, upper floor, or standalone basement
  // still identifies a particular unit and must agree.
  return street
    .replace(/\b(ST|RD|AVE|BLVD|DR|LN|HWY|FL|BSMT|PATIO|PORCH)\s+ONLY$/, '$1')
    .replace(/(?:\s+(?:AND\s+)?(?:OUTDOOR\s+)?(?:PATIO|PORCH|DECK|BALCONY))+$/, '')
    .replace(/\s+1\s+FL(?:\s+(?:AND\s+)?(?:PARTIAL\s+)?BSMT)?$/, '');
}

function streetsMatch(expected: string, found: string, ohio: boolean) {
  if (expected === found) return true;
  if (!ohio) return false;
  const permitStreet = ohioStreetKey(expected);
  const publicStreet = ohioStreetKey(found);
  if (permitStreet && permitStreet === publicStreet) return true;
  // A source can supply a single unit that the permit omits. When the permit
  // specifies a unit, the source must confirm that same unit.
  return Boolean(permitStreet && !/\bUNIT\b/.test(permitStreet)
    && publicStreet.match(/^(.+)\s+UNIT\s+[A-Z0-9]+$/)?.[1] === permitStreet);
}

export function compareAccountResearchLocations(expected: Location, found: Location) {
  const expectedState = normalizeUsState(expected.state);
  const foundState = normalizeUsState(found.state);
  const expectedZip = zip5(expected.zip);
  const foundZip = zip5(found.zip);
  const state = Boolean(expectedState && expectedState === foundState);
  const zip = Boolean(expectedZip && expectedZip === foundZip);
  const ohioZip = state && zip && expectedState === 'OH' ? expectedZip ?? null : null;
  const expectedAddress = parseAddress(expected.address, ohioZip);
  const foundAddress = parseAddress(found.address, ohioZip);
  return {
    streetNumber: Boolean(expectedAddress && foundAddress
      && houseNumbersMatch(expectedAddress.numbers, foundAddress.numbers, Boolean(ohioZip))),
    streetAddress: Boolean(expectedAddress && foundAddress
      && streetsMatch(expectedAddress.street, foundAddress.street, Boolean(ohioZip))),
    city: citiesMatch(expected.city, found.city, ohioZip),
    state,
    zip,
  };
}
