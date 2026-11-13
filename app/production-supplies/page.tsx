import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { requireSupplyActor } from '../../lib/productionSupplies/access';
import { getSupplyStatusDashboard } from '../../lib/productionSupplies/status';
import { getTrackingConfiguration } from '../../lib/productionSupplies/tracking';
import { EmptyState, PageHeader } from '../components/PageChrome';
import { SupplyStatusCard } from './SupplyStatusCard';
import { SupplyRefresh } from './SupplyRefresh';
import './supplies.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Supplies' };

export default async function SuppliesPage() {
  const { actor, canManage } = await requireSupplyActor();
  const [dashboard, mailboxes] = await Promise.all([
    getSupplyStatusDashboard(actor.organizationId),
    prisma.supplyMailboxSync.findMany({ where: { organizationId: actor.organizationId, status: { not: 'PAUSED' } }, select: { status: true } }),
  ]);
  const connectionRequired = !mailboxes.length || mailboxes.some(mailbox => ['CONNECTION_REQUIRED', 'PERMISSION_REQUIRED', 'ERROR'].includes(mailbox.status));
  const importing = mailboxes.some(mailbox => ['INITIAL_IMPORT', 'QUEUED'].includes(mailbox.status));
  const tracking = getTrackingConfiguration();

  return <div className="supplies-page supply-status-page">
    <PageHeader title="Supplies" />
    <SupplyRefresh />
    {connectionRequired || importing ? <p className="supply-status-coverage" role="status">
      {connectionRequired ? <>Email coverage is incomplete. <Link href="/production-supplies/settings">Check connections</Link>.</> : 'Initial email import is running.'}
      {' '}Order status may be incomplete.
    </p> : null}
    {tracking.configured && tracking.mode === 'test' ? <p className="supply-status-coverage" role="status">Carrier tracking is in test mode. Carrier updates may be simulated.</p> : null}
    {dashboard.cards.length ? <>
      <div className="supply-status-grid" aria-label="Supply status">
        {dashboard.cards.map(card => <SupplyStatusCard key={`${card.id}:${card.cycleKey}`} card={card} canDismiss={canManage} />)}
      </div>
      {!tracking.configured ? <p className="supply-status-footnote">Live carrier updates are unavailable. Cards show the latest available email or delivery information.</p> : null}
    </> : <EmptyState title={dashboard.monitoredMaterials ? 'Nothing being tracked' : 'No supplies yet'} description={dashboard.monitoredMaterials ? 'Delivered and dismissed supplies are hidden.' : 'Supplies appear from Dx5 alerts or confirmed Production orders.'} />}
  </div>;
}
