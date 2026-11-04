/** Preserve the directory identifier as text, including any leading zeroes. */
export function OhioAgencyNumber({ agencyId, state }: { agencyId: string; state: string | null }) {
  if (state?.trim().toUpperCase() !== 'OH' || !agencyId.trim()) return null;
  return <p className="account-kind muted">Agency #{agencyId}</p>;
}
