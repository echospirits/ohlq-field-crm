const normalizeAddressToken = (value: string) => {
  const ordinalWords: Record<string, string> = {
    EIGHTH: '8',
    FIFTH: '5',
    FIRST: '1',
    FOURTH: '4',
    NINTH: '9',
    SECOND: '2',
    SEVENTH: '7',
    SIXTH: '6',
    TENTH: '10',
    THIRD: '3',
  };
  const replacements: Record<string, string> = {
    AV: 'AVE',
    AVENUE: 'AVE',
    BOULEVARD: 'BLVD',
    CENTER: 'CTR',
    CIRCLE: 'CIR',
    COURT: 'CT',
    DRIVE: 'DR',
    EAST: 'E',
    HIGHWAY: 'HWY',
    LANE: 'LN',
    NORTH: 'N',
    OHIO: 'OH',
    PARKWAY: 'PKWY',
    PLACE: 'PL',
    ROAD: 'RD',
    SOUTH: 'S',
    STREET: 'ST',
    TERRACE: 'TER',
    WEST: 'W',
  };

  const withoutOrdinalSuffix = value.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1');
  return ordinalWords[withoutOrdinalSuffix] ?? replacements[withoutOrdinalSuffix] ?? withoutOrdinalSuffix;
};

export const normalizeOhlqAddressPart = (value: string | null | undefined) => {
  const normalized = String(value ?? '')
    .toUpperCase()
    .replace(/[^\dA-Z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeAddressToken)
    .join(' ');

  return normalized || null;
};
