'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupplyStatusCard as StatusCard } from '../../lib/productionSupplies/status';
import { ActionForm } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { dismissSupplyStatusAction } from './statusActions';
import { arrivalSource, arrivalText, displayStatus, observed, shortDate, supplyOrderMilestones, supplyWatchLabel } from './display';

export function SupplyStatusCard({ card, canDismiss }: { card: StatusCard; canDismiss: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const router = useRouter();
  if (dismissed) return null;
  const arrival = card.arrival ? { ...card.arrival, current: true, sourceEventAt: card.arrival.observedAt } : undefined;
  const status = card.status === 'INCOMING' && card.shipmentStatus ? displayStatus(card.shipmentStatus) : card.status === 'ORDERED' ? card.shipmentStatus === 'LABEL_CREATED' ? 'Label created' : 'Ordered' : card.statusLabel;
  const milestones = supplyOrderMilestones(card);
  return <article className="supply-status-card" aria-labelledby={`supply-${card.id}`}>
    <div className="supply-status-identity"><h2 id={`supply-${card.id}`}>{card.material}</h2><p>{card.location}</p></div>
    <div className="supply-status-current">
      <p className={`supply-status-label${card.status === 'ATTENTION' ? ' supply-status-label-attention' : ''}`}>{status}</p>
      {arrival ? <><p className="supply-status-arrival">{arrivalText(arrival)}</p><p className="supply-status-source">{arrivalSource(arrival.source)} · {observed(arrival.observedAt)}</p></> : null}
      {card.status === 'ATTENTION' && card.detail ? <p className="supply-status-detail">{card.detail}</p> : !arrival && ['ORDERED', 'INCOMING'].includes(card.status) ? <p className="supply-status-detail">Arrival not available</p> : null}
      {milestones.map(milestone => <p key={milestone.label} className="supply-status-source">{milestone.label} · <time dateTime={milestone.date}>{shortDate(milestone.date)}</time></p>)}
      {card.supplier ? <p className="supply-status-order">{card.supplier}{card.orderReference ? ` · ${card.orderReference}` : ''}</p> : null}
    </div>
    <footer className="supply-status-footer">
      <p>{supplyWatchLabel(card.watchSource)} · <time dateTime={card.triggerAt}>{shortDate(card.triggerAt)}</time></p>
      {canDismiss ? <ActionForm action={dismissSupplyStatusAction} onSuccess={() => { setDismissed(true); router.refresh(); }}>
        <input type="hidden" name="needId" value={card.needId} /><input type="hidden" name="cycleKey" value={card.cycleKey} />
        <SubmitButton className="secondary" pendingLabel="Dismissing…" aria-label={`Dismiss ${card.material} at ${card.location}`}>Dismiss</SubmitButton>
      </ActionForm> : null}
    </footer>
  </article>;
}
