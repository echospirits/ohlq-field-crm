import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { requireSupplyActor } from '../../lib/productionSupplies/access';
import { productionMemberIds, readSupplySettings } from '../../lib/productionSupplies/config';
import { supplyEmailCoverage } from '../../lib/productionSupplies/mailFreshness';
import { getSupplyStatusDashboard } from '../../lib/productionSupplies/status';
import { getTrackingConfiguration } from '../../lib/productionSupplies/tracking';
import { EmptyState, PageHeader } from '../components/PageChrome';
import { SupplyStatusCard } from './SupplyStatusCard';
import { SupplyRefresh } from './SupplyRefresh';
import './supplies.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Supplies' };

export default async function SuppliesPage() {
  const { actor, context, canManage } = await requireSupplyActor();
  const { crmPreferences, timezone } = context.organization;
  const [dashboard, mailboxes] = await Promise.all([
    getSupplyStatusDashboard(actor.organizationId),
    prisma.supplyMailboxSync.findMany({
      where: { organizationId: actor.organizationId, userId: { in: productionMemberIds(crmPreferences) }, status: { not: 'PAUSED' } },
      select: { status: true, connectionId: true, cursor: true, lastSuccessfulSyncAt: true },
    }),
  ]);
  const coverage = supplyEmailCoverage(mailboxes, readSupplySettings(crmPreferences).pollMinutes, new Date());
  const oldestCheckAt = coverage.oldestCheckAt;
  const emailCheckDate = coverage.stale && oldestCheckAt ? new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(oldestCheckAt) : null;
  const tracking = getTrackingConfiguration();

  return <div className="supplies-page supply-status-page">
    <PageHeader title="Supplies" />
    <SupplyRefresh />
    {coverage.stale || coverage.connectionRequired || coverage.awaitingCheck || coverage.importing ? <p className="supply-status-coverage" role="status">
      {coverage.stale && oldestCheckAt && emailCheckDate ? <><strong>Email updates are stale.</strong> The oldest completed mailbox check was <time dateTime={oldestCheckAt.toISOString()}>{emailCheckDate}</time>.</> :
        coverage.connectionRequired ? 'Email coverage is incomplete.' :
          coverage.awaitingCheck ? 'Waiting for the first recent email check.' : 'Initial email import is running.'}
      {' '}<Link href="/production-supplies/settings">Mailbox status</Link>
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
