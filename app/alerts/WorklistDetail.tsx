import { splitReactivationPurchasedAgainDetail } from '../../lib/ohlqWholesaleReactivation';

export function WorklistDetail({ detail }: { detail: string | null }) {
  const parsed = splitReactivationPurchasedAgainDetail(detail);

  return (
    <>
      {parsed.purchasedAgainMessage ? (
        <div className="worklist-warning-ribbon">{parsed.purchasedAgainMessage}</div>
      ) : null}
      {parsed.detail ? <div className="muted preserve-lines">{parsed.detail}</div> : null}
    </>
  );
}
