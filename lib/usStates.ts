export const US_STATES = Object.entries({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}).map(([code, name]) => ({ code, name }));

export function normalizeUsState(value: string | null | undefined): string | null {
  const clean = (value ?? '').trim().toUpperCase();
  return US_STATES.find(({ code, name }) => code === clean || name.toUpperCase() === clean)?.code ?? null;
}

// Existing OHLQ accounts predate state selection and default to Ohio.
export const isOhioAccount = (state: string | null | undefined) => !state?.trim() || normalizeUsState(state) === 'OH';
export const isOutsideOhio = (state: string | null | undefined) => Boolean(normalizeUsState(state) && !isOhioAccount(state));

// Permit numbers are state-specific; never let a manually entered out-of-state
// number join an unrelated OHLQ import with the same numeric identifier.
export const stateScopedLicenseeIds = (ids: string[], state: string) => ids.map(id =>
  state === 'OH' || /^MANUAL-/i.test(id) || id.startsWith(`${state}:`) ? id : `${state}:${id}`,
);
