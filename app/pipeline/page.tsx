export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { AccountSalesStatus, SalesAccountType, WorklistStatus } from '@prisma/client';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { BUYING_STATE_LABELS, countSalesStatuses, getBuyingState, getNeedsAttentionReasons, SALES_STATUS_LABELS, SALES_STATUS_OPTIONS } from '../../lib/accountSalesStatus';
import { formatEasternDate } from '../../lib/dateTime';
import { requireFeatureForUser } from '../../lib/organizations';
import { getTenantSalesWhere } from '../../lib/ohlqSalesData';
import { prisma } from '../../lib/prisma';
import { getOrganizationTenantConfig } from '../../lib/tenantConfig';
import { PageHeader } from '../components/PageChrome';
import { SalesStatusJourney } from '../components/SalesStatusJourney';

export const metadata = buildPageMetadata('Pipeline');

const DAY = 86_400_000;
const daysInStatus = (date: Date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY));

export default async function PipelinePage({ searchParams }: { searchParams?: Promise<{ status?: string; view?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'ACCOUNT_SALES_STATUS');
  const params = await searchParams;
  const requestedStatus = params?.status;
  const view = params?.view === 'list' ? 'list' : 'board';
  const selectedStatus = Object.values(AccountSalesStatus).includes(requestedStatus as AccountSalesStatus) ? requestedStatus as AccountSalesStatus : null;
  const now = new Date();
  const config = await getOrganizationTenantConfig(organizationId);
  const overlays = await prisma.organizationAccountOverlay.findMany({
    where: { organizationId, salesStatus: { not: null } },
    orderBy: [{ salesStatusUpdatedAt: 'desc' }],
    select: { accountType: true, assignedUserId: true, externalAccountId: true, salesStatus: true, salesStatusUpdatedAt: true, isTargeting: true },
  });
  const agencyIds = overlays.filter((row) => row.accountType === SalesAccountType.AGENCY).map((row) => row.externalAccountId);
  const wholesaleIds = overlays.filter((row) => row.accountType === SalesAccountType.WHOLESALE).map((row) => row.externalAccountId);
  const [agencies, wholesaleAccounts, users, visits, worklist, wholesalePurchases, recentMovement] = await Promise.all([
    prisma.agency.findMany({ where: { id: { in: agencyIds } }, select: { id: true, agencyId: true, city: true, name: true } }),
    prisma.wholesaleAccount.findMany({ where: { id: { in: wholesaleIds }, mergedIntoId: null }, select: { id: true, city: true, name: true } }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, email: true, firstName: true, lastName: true, name: true } }),
    prisma.loggedVisit.findMany({ where: { organizationId, OR: [{ agencyId: { in: agencyIds } }, { wholesaleAccountId: { in: wholesaleIds } }] }, orderBy: { visitAt: 'desc' }, select: { agencyId: true, wholesaleAccountId: true, visitAt: true } }),
    prisma.worklistItem.findMany({ where: { organizationId, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] }, OR: [{ agencyId: { in: agencyIds } }, { wholesaleAccountId: { in: wholesaleIds } }] }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], select: { agencyId: true, wholesaleAccountId: true, dueDate: true, title: true } }),
    prisma.accountSalesEvent.findMany({ where: { organizationId, wholesaleAccountId: { in: wholesaleIds }, isTenantProduct: true, bottles: { gt: 0 } }, orderBy: { reportDate: 'desc' }, select: { wholesaleAccountId: true, reportDate: true } }),
    prisma.accountSalesStatusHistory.findMany({ where: { organizationId }, orderBy: { changedAt: 'desc' }, take: 12 }),
  ]);
  const agencySalesRows = agencies.length ? await prisma.ohlqAnnualSalesRow.findMany({
    where: { agencyId: { in: agencies.map((agency) => agency.agencyId) }, retailBottlesSold: { gt: 0 }, ...getTenantSalesWhere(config) },
    orderBy: { reportDate: 'desc' }, select: { agencyId: true, reportDate: true },
  }) : [];
  const agenciesById = new Map(agencies.map((agency) => [agency.id, agency]));
  const wholesaleById = new Map(wholesaleAccounts.map((account) => [account.id, account]));
  const usersById = new Map(users.map((entry) => [entry.id, getUserDisplayName(entry)]));
  const lastVisitByKey = new Map<string, Date>();
  visits.forEach((visit) => {
    const key = visit.agencyId ? `AGENCY:${visit.agencyId}` : `WHOLESALE:${visit.wholesaleAccountId}`;
    if (!lastVisitByKey.has(key)) lastVisitByKey.set(key, visit.visitAt);
  });
  const nextActionByKey = new Map<string, { dueDate: Date | null; title: string }>();
  worklist.filter((item) => item.dueDate && item.dueDate >= now).forEach((item) => {
    const key = item.agencyId ? `AGENCY:${item.agencyId}` : `WHOLESALE:${item.wholesaleAccountId}`;
    if (!nextActionByKey.has(key)) nextActionByKey.set(key, item);
  });
  const wholesalePurchaseById = new Map<string, Date>();
  wholesalePurchases.forEach((purchase) => { if (!wholesalePurchaseById.has(purchase.wholesaleAccountId)) wholesalePurchaseById.set(purchase.wholesaleAccountId, purchase.reportDate); });
  const agencyPurchaseByNumber = new Map<string, Date>();
  agencySalesRows.forEach((purchase) => { if (!agencyPurchaseByNumber.has(purchase.agencyId)) agencyPurchaseByNumber.set(purchase.agencyId, purchase.reportDate); });
  const allRows = overlays.flatMap((overlay) => {
    const account = overlay.accountType === SalesAccountType.AGENCY ? agenciesById.get(overlay.externalAccountId) : wholesaleById.get(overlay.externalAccountId);
    if (!account || !overlay.salesStatus || !overlay.salesStatusUpdatedAt) return [];
    const key = `${overlay.accountType}:${overlay.externalAccountId}`;
    const lastPurchaseAt = overlay.accountType === SalesAccountType.AGENCY ? agencyPurchaseByNumber.get((account as typeof agencies[number]).agencyId) ?? null : wholesalePurchaseById.get(overlay.externalAccountId) ?? null;
    const nextAction = nextActionByKey.get(key) ?? null;
    const lastActivityAt = lastVisitByKey.get(key) ?? null;
    return [{ ...overlay, account, buyingState: getBuyingState(lastPurchaseAt, now), lastActivityAt, lastPurchaseAt, nextAction, attention: getNeedsAttentionReasons({ status: overlay.salesStatus, statusUpdatedAt: overlay.salesStatusUpdatedAt, lastActivityAt, lastPurchaseAt, nextActionAt: nextAction?.dueDate ?? null, now }) }];
  });
  const rows = allRows.filter((row) => !selectedStatus || row.salesStatus === selectedStatus);
  const counts = countSalesStatuses(allRows.map((row) => row.salesStatus!));
  const pipelineHref = (nextView: string, status: AccountSalesStatus | null = selectedStatus) => `/pipeline?${new URLSearchParams({ view: nextView, ...(status ? { status } : {}) })}`;
  const nameFor = (type: SalesAccountType, id: string) => type === SalesAccountType.AGENCY ? agenciesById.get(id)?.name : wholesaleById.get(id)?.name;

  return <>
    <PageHeader eyebrow="Accounts" title="Pipeline" description="Where relationships stand, what needs attention, and recent movement. Worklist remains the source of truth for next actions." />
    <SalesStatusJourney currentStatus={selectedStatus} counts={counts} filterHref={(status) => pipelineHref(view, selectedStatus === status ? null : status)} />
    <nav className="scope-tabs" aria-label="Pipeline view">
      <Link href={pipelineHref('board')} aria-current={view === 'board' ? 'page' : undefined}>Kanban board</Link>
      <Link href={pipelineHref('list')} aria-current={view === 'list' ? 'page' : undefined}>List</Link>
      {selectedStatus ? <Link href={pipelineHref(view, null)}>Clear status filter</Link> : null}
    </nav>

    {view === 'board' ? <section className="dashboard-section" aria-label="Accounts by sales status">
      <div className="section-heading"><div><span className="page-eyebrow">Pipeline snapshot</span><h2>Accounts by status</h2><p className="muted">Open an account to update its status or log a visit.</p></div><span className="pill">{rows.length} account{rows.length === 1 ? '' : 's'}</span></div>
      <div className="pipeline-kanban">
        {SALES_STATUS_OPTIONS.filter((option) => !selectedStatus || selectedStatus === option.value).map((option) => {
          const stageRows = rows.filter((row) => row.salesStatus === option.value);
          return <details className="pipeline-kanban-column" data-sales-stage={option.value} key={`${selectedStatus ?? 'all'}-${option.value}`}>
            <summary><h3>{option.label}</h3><span className="pill">{stageRows.length}</span><svg className="pipeline-kanban-chevron" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 5 7 7-7 7" /></svg></summary>
            {stageRows.map((row) => <article className="pipeline-kanban-card" key={`${row.accountType}:${row.externalAccountId}`}>
              <Link className="pipeline-kanban-account" href={row.accountType === SalesAccountType.AGENCY ? `/agencies/${row.externalAccountId}` : `/wholesale/${row.externalAccountId}`}>{row.account.name}</Link>{row.isTargeting ? <small className="target-account-marker">TARGET ACCOUNT</small> : null}
              <span className="muted">{row.accountType === SalesAccountType.AGENCY ? 'Agency' : 'Wholesale'}{row.account.city ? ` · ${row.account.city}` : ''}</span>
              <span>{BUYING_STATE_LABELS[row.buyingState]} · {daysInStatus(row.salesStatusUpdatedAt!)} days in status</span>
              <span className="muted">{row.assignedUserId ? usersById.get(row.assignedUserId) ?? 'Former team member' : 'Unassigned'}</span>
              <span><strong>Next:</strong> {row.nextAction ? `${row.nextAction.title}${row.nextAction.dueDate ? ` · ${formatEasternDate(row.nextAction.dueDate)}` : ''}` : 'No follow-up scheduled'}</span>
              {row.attention.length ? <span className="pipeline-kanban-attention">Needs attention: {row.attention.join(' · ')}</span> : null}
            </article>)}
            {!stageRows.length ? <p className="pipeline-kanban-empty">No tracked accounts in {option.label}.</p> : null}
          </details>;
        })}
      </div>
      {!allRows.length ? <p className="muted">Set Sales Status on an <Link href="/agencies">Agency</Link> or <Link href="/wholesale">Wholesale Account</Link> to add it to your pipeline.</p> : null}
    </section> : <section className="dashboard-section">
      <div className="section-heading"><div><span className="page-eyebrow">Pipeline snapshot</span><h2>{selectedStatus ? SALES_STATUS_LABELS[selectedStatus] : 'Tracked accounts'}</h2></div><span className="pill">{rows.length}</span></div>
      {rows.length ? <div className="pipeline-account-list">
        {rows.map((row) => {
          const href = row.accountType === SalesAccountType.AGENCY ? `/agencies/${row.externalAccountId}` : `/wholesale/${row.externalAccountId}`;
          return <article className="pipeline-account-row" key={`${row.accountType}:${row.externalAccountId}`}>
            <div className="pipeline-account-identity"><Link href={href}>{row.account.name}</Link>{row.isTargeting ? <small className="target-account-marker">TARGET ACCOUNT</small> : null}<span>{row.accountType === SalesAccountType.AGENCY ? 'Agency' : 'Wholesale'}{row.account.city ? ` · ${row.account.city}` : ''}</span></div>
            <span><small>Sales Status</small><strong>{SALES_STATUS_LABELS[row.salesStatus!]}</strong></span>
            <span><small>Buying State</small><strong>{BUYING_STATE_LABELS[row.buyingState]}</strong></span>
            <span><small>Owner</small><strong>{row.assignedUserId ? usersById.get(row.assignedUserId) ?? 'Former team member' : 'Unassigned'}</strong></span>
            <span><small>Last activity</small><strong>{formatEasternDate(row.lastActivityAt) || 'None'}</strong></span>
            <span><small>Last purchase</small><strong>{formatEasternDate(row.lastPurchaseAt) || 'None'}</strong></span>
            <span><small>Next follow-up</small><strong>{row.nextAction ? `${row.nextAction.title}${row.nextAction.dueDate ? ` · ${formatEasternDate(row.nextAction.dueDate)}` : ''}` : 'None scheduled'}</strong></span>
            <span><small>Time in status</small><strong>{daysInStatus(row.salesStatusUpdatedAt!)} days</strong></span>
            <span className={row.attention.length ? 'pipeline-attention needs-attention' : 'pipeline-attention'}><small>Needs Attention</small><strong>{row.attention[0] ?? 'On track'}</strong>{row.attention.length > 1 ? <em>+{row.attention.length - 1} more</em> : null}</span>
          </article>;
        })}
      </div> : <div className="card empty-state"><h3>No tracked accounts{selectedStatus ? ` in ${SALES_STATUS_LABELS[selectedStatus]}` : ''}</h3><p>Set Sales Status from an Agency or Wholesale Account page, or clear this filter.</p>{selectedStatus ? <Link className="btn secondary" href={pipelineHref(view, null)}>Clear filter</Link> : null}</div>}
    </section>}

    <div className="pipeline-support-grid">
      <section className="card"><div className="section-heading"><div><span className="page-eyebrow">Needs Attention</span><h2>Follow-up gaps</h2></div></div>{rows.filter((row) => row.attention.length).slice(0, 10).map((row) => <div className="pipeline-support-row" key={`attention-${row.accountType}-${row.externalAccountId}`}><Link href={row.accountType === SalesAccountType.AGENCY ? `/agencies/${row.externalAccountId}` : `/wholesale/${row.externalAccountId}`}>{row.account.name}</Link><span>{row.attention.join(' · ')}</span></div>)}{!rows.some((row) => row.attention.length) ? <p className="muted">No tracked accounts currently meet the pilot attention rules.</p> : null}</section>
      <section className="card"><div className="section-heading"><div><span className="page-eyebrow">Recent Movement</span><h2>Status changes</h2></div></div>{recentMovement.map((event) => <div className="pipeline-support-row" key={event.id}><strong>{nameFor(event.accountType, event.externalAccountId) ?? 'Account'}</strong><span>{event.source === 'SALES_DATA' ? 'Purchase detected → Purchasing' : `${event.previousStatus ? SALES_STATUS_LABELS[event.previousStatus] : 'Not set'} → ${SALES_STATUS_LABELS[event.newStatus]}`} · {formatEasternDate(event.changedAt)}</span></div>)}{recentMovement.length === 0 ? <p className="muted">No status movement yet.</p> : null}</section>
    </div>
  </>;
}
