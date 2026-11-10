export const cases = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
/** Operational stock quantities keep the DC report's source precision. */
export const caseQuantity = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 4 });
/** Preserve the source's case precision so a small shortfall never reads as -0. */
export const caseBalance = (value: number | null) => value === null ? 'Unavailable' : value === 0 ? '0' : `${value > 0 ? '+' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
export const trend = (value: number | null) => value === null ? 'Unavailable' : `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
