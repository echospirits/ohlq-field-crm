import { OpportunityStatus, Prisma } from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate } from '../../lib/dateTime';
import { getOhlqWindowStartDate, summarizeLinkedWholesaleAccountSales } from '../../lib/ohlqSalesData';
import { prisma } from '../../lib/prisma';
import { ContextualActions } from '../components/ContextualActions';
import type { ReactNode } from 'react';

const activeStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED];

const firstExplanation = (explanation: Prisma.JsonValue) =>
  Array.isArray(explanation) && explanation.length > 0 ? String(explanation[0]) : 'Review the current account signals.';

function IntelligenceFacts({ facts }: { facts: Array<{ label: string; value: number | string }> }) {
  return <dl className="account-intelligence-facts">
    {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
  </dl>;
}

function OpportunityRow({
  accountHref,
  accountName,
  explanation,
  priorityBand,
  recommendedAction,
  title,
  actions,
}: {
  accountHref?: string;
  accountName?: string;
  explanation: string;
  priorityBand: string;
  recommendedAction: string;
  title: string;
  actions?: ReactNode;
}) {
  return <article className="account-opportunity-row">
    <span className={`priority priority-${priorityBand.toLowerCase()}`}>{priorityBand}</span>
    <div className="account-opportunity-content">
      <div className="account-opportunity-title">
        {accountHref && accountName ? <Link href={accountHref}>{accountName}</Link> : null}
        {accountHref && accountName ? <span aria-hidden="true">·</span> : null}
        {accountHref && accountName ? <span className="sr-only">Opportunity: </span> : null}
        <strong>{title}</strong>
      </div>
      <div className="account-opportunity-meta">
        <span>{explanation}</span>
        <span className="account-opportunity-next"><strong>Next</strong> {recommendedAction}</span>
      </div>
    </div>
    {actions}
  </article>;
}

export async function OpportunityAccountPanel({ agencyId, wholesaleAccountId, currentUserId, users, returnTo }: { agencyId?: string; wholesaleAccountId?: string; currentUserId: string; users: Array<{ id: string; name: string }>; returnTo?: string }) {
  const isAgencyRollup = Boolean(agencyId && !wholesaleAccountId);
  const opportunityWhere: Prisma.SalesOpportunityWhereInput = wholesaleAccountId
    ? { wholesaleAccountId, status: { in: activeStatuses } }
    : { status: { in: activeStatuses }, wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' } } };
  if (isAgencyRollup) {
    const [linkedAccounts, latestWholesaleReport] = await Promise.all([
      prisma.wholesaleAccount.findMany({
        where: { agencyId: { equals: agencyId, mode: 'insensitive' }, mergedIntoId: null },
        include: { licenseeIds: { select: { licenseeId: true } } },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      prisma.ohlqAnnualSalesByWholesaleRow.findFirst({
        orderBy: { reportDate: 'desc' },
        select: { reportDate: true },
      }),
    ]);
    const salesStart = latestWholesaleReport ? getOhlqWindowStartDate(latestWholesaleReport.reportDate, 30) : null;
    const [opportunities, openFollowUps, salesRows] = await Promise.all([
      prisma.salesOpportunity.findMany({
        where: opportunityWhere,
        include: { wholesaleAccount: { select: { id: true, name: true } } },
        orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
        take: 12,
      }),
      prisma.worklistItem.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          salesOpportunity: {
            is: {
              status: { in: activeStatuses },
              wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' } },
            },
          },
        },
      }),
      salesStart ? prisma.ohlqAnnualSalesByWholesaleRow.findMany({
        where: {
          agencyId: { equals: agencyId, mode: 'insensitive' },
          reportDate: { gte: salesStart, lte: latestWholesaleReport!.reportDate },
        },
        select: { brand: true, permitNumber: true, vendor: true, wholesaleBottlesSold: true },
      }) : Promise.resolve([]),
    ]);
    const salesByAccount = summarizeLinkedWholesaleAccountSales({ accounts: linkedAccounts, rows: salesRows });
    const pursuing = opportunities.filter((item) => item.status === OpportunityStatus.ACTIONED).length;
    const highPriority = opportunities.filter((item) => item.priorityBand === 'HIGH').length;
    const accountSales = linkedAccounts.map((account) => ({
      account,
      sales: salesByAccount.get(account.id) ?? { accountId: account.id, allBottles: 0, echoBottles: 0 },
    }));
    const echoBottles30 = accountSales.reduce((total, item) => total + item.sales.echoBottles, 0);
    const allBottles30 = accountSales.reduce((total, item) => total + item.sales.allBottles, 0);
    const buyingAccounts = accountSales.filter((item) => item.sales.allBottles > 0).length;
    const opportunityByAccount = new Map(opportunities.map((item) => [item.wholesaleAccountId, item]));

    return <section className="card account-opportunity-panel">
      <div className="section-heading account-opportunity-heading"><div><span className="page-eyebrow">Linked wholesale accounts</span><h2>Opportunity intelligence</h2></div><Link className="btn secondary compact-btn" href="/opportunities">View inbox</Link></div>
      <IntelligenceFacts facts={[
        { label: 'Active', value: opportunities.length },
        { label: 'High priority', value: highPriority },
        { label: 'Pursuing', value: pursuing },
        { label: 'Follow-ups', value: openFollowUps },
        { label: 'Linked accounts', value: linkedAccounts.length },
        { label: 'Buying / 30d', value: buyingAccounts },
        { label: 'Echo bottles / 30d', value: echoBottles30 },
        { label: 'All bottles / 30d', value: allBottles30 },
      ]} />
      {accountSales.slice(0, 12).map(({ account, sales }) => {
        const opportunity = opportunityByAccount.get(account.id);
        const salesExplanation = `${sales.echoBottles} Echo · ${sales.allBottles} total bottles in 30 days`;
        return <OpportunityRow
          accountHref={`/wholesale/${account.id}`}
          accountName={account.name}
          explanation={opportunity ? `${firstExplanation(opportunity.explanation)} · ${salesExplanation}` : salesExplanation}
          key={account.id}
          priorityBand={opportunity?.priorityBand ?? (sales.echoBottles > 0 ? 'MEDIUM' : 'LOW')}
          recommendedAction={opportunity?.recommendedAction ?? (sales.echoBottles > 0 ? 'Maintain relationship' : 'Review account')}
          title={opportunity?.title ?? (sales.allBottles > 0 ? 'Recent wholesale activity' : 'No recent wholesale purchases')}
          actions={<ContextualActions
            context={{ accountName: account.name, opportunityId: opportunity?.id, reason: opportunity ? firstExplanation(opportunity.explanation) : salesExplanation, returnTo, sourceLabel: opportunity?.title ?? 'wholesale account activity', sourceType: opportunity?.type ?? 'AGENCY_WHOLESALE_ROLLUP', wholesaleAccountId: account.id }}
            currentUserId={currentUserId}
            users={users}
          />}
        />;
      })}
      {linkedAccounts.length === 0 ? <p className="muted activity-empty">No wholesale accounts are linked to this agency.</p> : null}
    </section>;
  }

  if (!wholesaleAccountId) return null;

  const [opportunities, sales, visits, worklist] = await Promise.all([
    prisma.salesOpportunity.findMany({
      where: opportunityWhere,
      include: { wholesaleAccount: { select: { id: true, name: true } } },
      orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
      take: 5,
    }),
    prisma.accountSalesEvent.findMany({ where: { wholesaleAccountId }, orderBy: { reportDate: 'desc' }, take: 30 }),
    prisma.loggedVisit.findMany({ where: { wholesaleAccountId, locationType: 'wholesale' }, orderBy: { visitAt: 'desc' }, take: 20, select: { id: true, visitAt: true, summary: true, createdBy: true } }),
    prisma.worklistItem.findMany({ where: { wholesaleAccountId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { dueDate: 'asc' }, take: 10, select: { id: true, title: true, dueDate: true, salesOpportunityId: true } }),
  ]);
  const timeline = [
    ...sales.map((event) => ({ at: event.reportDate, kind: 'purchase', title: `${event.itemCode} - ${event.itemName}`, detail: `${event.bottles} bottle${event.bottles === 1 ? '' : 's'} purchased` })),
    ...visits.map((visit) => ({ at: visit.visitAt, kind: 'visit', title: `${visit.createdBy ?? 'Team member'} visited`, detail: visit.summary ?? 'Visit logged' })),
    ...opportunities.map((item) => ({ at: item.detectedAt, kind: 'opportunity', title: `${item.title} detected`, detail: item.recommendedAction })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 40);
  const echo90 = sales.filter((event) => event.isTenantProduct && event.reportDate >= new Date(Date.now() - 90 * 86_400_000)).reduce((sum, event) => sum + event.bottles, 0);
  return <>
    <section className="card account-opportunity-panel"><div className="section-heading account-opportunity-heading"><div><span className="page-eyebrow">Why care right now?</span><h2>Opportunity intelligence</h2></div><Link className="btn secondary compact-btn" href="/opportunities">View inbox</Link></div>
      <IntelligenceFacts facts={[
        { label: 'Active', value: opportunities.length },
        { label: 'Echo bottles / 90d', value: echo90 },
        { label: 'Last visit', value: visits[0] ? formatEasternDate(visits[0].visitAt) : 'Never' },
        { label: 'Follow-ups', value: worklist.length },
      ]} />
      {opportunities.slice(0, 3).map((item) => <OpportunityRow
        explanation={firstExplanation(item.explanation)}
        key={item.id}
        priorityBand={item.priorityBand}
        recommendedAction={item.recommendedAction}
        title={item.title}
        actions={<ContextualActions
          context={{ accountName: item.wholesaleAccount.name, opportunityId: item.id, reason: firstExplanation(item.explanation), returnTo: `/wholesale/${wholesaleAccountId}`, sourceLabel: item.title, sourceType: item.type, wholesaleAccountId }}
          currentUserId={currentUserId}
          hasExistingFollowUp={worklist.some((task) => task.salesOpportunityId === item.id)}
          users={users}
        />}
      />)}
      {opportunities.length === 0 ? <p className="muted activity-empty">No active Opportunities for this account.</p> : null}
    </section>
    <section className="dashboard-section unified-timeline"><div className="section-heading"><h2>Activity + sales timeline</h2><span className="pill">{timeline.length}</span></div>{timeline.map((event, index) => <article className={`timeline-event timeline-${event.kind}`} key={`${event.kind}-${event.at.toISOString()}-${index}`}><time>{formatEasternDate(event.at)}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}</section>
  </>;
}
