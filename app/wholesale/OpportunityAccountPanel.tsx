import { OpportunityStatus, Prisma } from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate, formatEasternDateTime } from '../../lib/dateTime';
import { getOhlqWindowStartDate, getTenantAccountSalesEventWhere, summarizeLinkedWholesaleAccountSales } from '../../lib/ohlqSalesData';
import { opportunityEvidence, opportunityFactors, parseOpportunityScoreComponents } from '../../lib/opportunityPresentation';
import { prisma } from '../../lib/prisma';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';
import type { ReactNode } from 'react';
import { getCurrentUser } from '../../lib/auth';
import { getOrganizationContext, hasFeature } from '../../lib/organizations';
import { getOrganizationTenantConfig } from '../../lib/tenantConfig';
import { readPublicRatings, readResearchEvidence } from '../../lib/accountResearchQueue';
import { isOutsideOhio } from '../../lib/usStates';

const activeStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED];

const firstExplanation = (explanation: Prisma.JsonValue) =>
  opportunityFactors(explanation)[0] ?? 'Review the current account signals.';

const displayResearchValue = (value: string | null | undefined) => value?.trim() || 'Not confirmed';

function ScoreBreakdown({ explanation, score, scoringVersion, scoredAt }: { explanation: Prisma.JsonValue; score: number; scoringVersion: string; scoredAt: Date }) {
  const factors = opportunityFactors(explanation);
  const components = parseOpportunityScoreComponents(factors);
  const evidence = opportunityEvidence(factors);
  return <div className="opportunity-score-detail">
    <div className="opportunity-score-summary">
      <div><strong>{Math.round(score)}</strong><span>out of 100</span></div>
      <p>{scoringVersion.startsWith('RESEARCH_FIT_') ? 'Provisional research-only score for your organization’s portfolio. Sales and bottle-price evidence are unavailable. Compare with other research-only accounts and confirm local distribution before pitching.' : 'This score is calculated for your organization using its active products, purchases, activity, public research, and learned outcomes.'}</p>
    </div>
    {components.length > 0 ? <>
      <h4>Point contributions</h4>
      <div className="opportunity-score-components">
        {components.map((component) => <div className={component.points < 0 ? 'is-negative' : ''} key={component.key}>
          <span>{component.label}</span>
          <strong>{component.points > 0 ? '+' : ''}{component.points.toFixed(1)}</strong>
          <span aria-hidden="true" className="opportunity-score-meter"><i style={{ width: `${Math.min(100, Math.abs(component.points) / 15 * 100)}%` }} /></span>
        </div>)}
      </div>
    </> : <p className="opportunity-score-legacy-note"><strong>Point-by-point values were not stored with this earlier score.</strong> The original evidence is shown below. Exact component values will appear after the next score refresh.</p>}
    {evidence.length > 0 ? <>
      <h4>Evidence and adjustments</h4>
      <ul className="opportunity-score-evidence">{evidence.map((factor, index) => <li key={`${factor}-${index}`}>{factor}</li>)}</ul>
    </> : <p className="muted">No detailed scoring evidence is available for this calculation.</p>}
    <small className="muted">Calculated {formatEasternDateTime(scoredAt)} · Model {scoringVersion}</small>
  </div>;
}

type AccountResearch = {
  buyerStructure: string | null;
  cocktailMenuUrl: string | null;
  cocktailProgram: string | null;
  events: string | null;
  googleRating: Prisma.Decimal | null;
  googleReviewCount: number | null;
  identitySnapshot: Prisma.JsonValue | null;
  isNationalChain: boolean | null;
  localBrandsOnMenu: Prisma.JsonValue;
  notes: string | null;
  openStatus: string | null;
  ownershipVerification: string | null;
  patioOutdoor: string | null;
  popularitySignal: string | null;
  privateDining: string | null;
  researchConfidence: string | null;
  sourceUrls: Prisma.JsonValue;
  updatedAt: Date;
  websiteUrl: string | null;
  yelpRating: Prisma.Decimal | null;
  yelpReviewCount: number | null;
};

const researchSourceNames = (evidence: ReturnType<typeof readResearchEvidence>, pattern: RegExp) => {
  const matches = evidence.filter((item) => pattern.test(item.field));
  return [...new Set(matches.map((item) => {
    try {
      const host = new URL(item.sourceUrl).hostname.replace(/^www\./, '');
      if (host === 'maps.apple.com') return 'Apple Maps';
      if (host.endsWith('google.com')) return 'Google';
      if (host.endsWith('yelp.com')) return 'Yelp';
      if (host.endsWith('restaurantji.com')) return 'Restaurantji';
      return item.sourceTitle?.trim() || host;
    } catch {
      return item.sourceTitle?.trim() || 'Public source';
    }
  }))];
};

function SourceLine({ names }: { names: string[] }) {
  return <small className="muted">Source: {names.length ? names.join(', ') : 'Not recorded'}</small>;
}

function ResearchSummary({ research, researchOnly = false }: { research: AccountResearch | null; researchOnly?: boolean }) {
  if (!research) return <section className="account-research-summary is-empty" aria-label="Account research summary">
    <div><h3>Public research</h3><p className="muted">{researchOnly ? 'Research is needed before a provisional fit score can be calculated. Add a complete street address, city, state and ZIP to make this account eligible. Purchase data is not available for this state.' : 'This account has not been researched yet. Its opportunity score currently relies on available sales and activity signals.'}</p></div>
  </section>;
  const brands = opportunityFactors(research.localBrandsOnMenu);
  const sources = opportunityFactors(research.sourceUrls);
  const evidence = readResearchEvidence(research.identitySnapshot);
  const storedRatings = readPublicRatings(research.identitySnapshot);
  const ratings = storedRatings.length ? storedRatings : [
    ...(research.googleRating ? [{ sourceName: 'Legacy source not recorded', sourceUrl: '', rating: Number(research.googleRating), reviewCount: research.googleReviewCount }] : []),
    ...(research.yelpRating ? [{ sourceName: 'Yelp', sourceUrl: '', rating: Number(research.yelpRating), reviewCount: research.yelpReviewCount }] : []),
  ];
  const links = [...new Set([research.websiteUrl, research.cocktailMenuUrl, ...sources].filter((url): url is string => Boolean(url)))];
  return <section className="account-research-summary" aria-label="Account research summary">
    <div className="account-research-heading">
      <div><span className="page-eyebrow">Public account research</span><h3>What we found</h3></div>
      <small className="muted">Updated {formatEasternDateTime(research.updatedAt)}</small>
    </div>
    <dl className="account-research-signals">
      {ratings.map((rating, index) => <div key={`${rating.sourceName}-${index}`}><dt>Public rating</dt><dd><strong>{rating.rating.toFixed(1)}</strong><span>{rating.reviewCount?.toLocaleString() ?? 'Unknown'} reviews</span><SourceLine names={[rating.sourceName]} /></dd></div>)}
      {!ratings.length ? <div><dt>Public rating</dt><dd><span>Not found</span><SourceLine names={[]} /></dd></div> : null}
      <div><dt>Patio</dt><dd><span>{displayResearchValue(research.patioOutdoor)}</span><SourceLine names={researchSourceNames(evidence, /patio|outdoor/i)} /></dd></div>
      <div><dt>Cocktails</dt><dd><span>{displayResearchValue(research.cocktailProgram)}</span><SourceLine names={researchSourceNames(evidence, /cocktail|menu/i)} /></dd></div>
      <div><dt>Popularity</dt><dd><span>{displayResearchValue(research.popularitySignal)}</span><SourceLine names={researchSourceNames(evidence, /popular|rating|review/i)} /></dd></div>
      <div><dt>Buying structure</dt><dd><span>{research.isNationalChain === true ? 'National chain' : research.isNationalChain === false ? 'Not a national chain' : displayResearchValue(research.buyerStructure)}</span><SourceLine names={researchSourceNames(evidence, /ownership|buyer|chain/i)} /></dd></div>
    </dl>
    <details className="compact-details nested-details account-research-details">
      <summary>Research details and sources</summary>
      <dl>
        <div><dt>Confidence</dt><dd>{displayResearchValue(research.researchConfidence)}</dd></div>
        <div><dt>Operating status</dt><dd>{displayResearchValue(research.openStatus)}</dd></div>
        <div><dt>Ownership</dt><dd>{displayResearchValue(research.ownershipVerification)}</dd></div>
        <div><dt>Buyer structure</dt><dd>{displayResearchValue(research.buyerStructure)}</dd></div>
        <div><dt>Events</dt><dd>{displayResearchValue(research.events)}</dd></div>
        <div><dt>Private dining</dt><dd>{displayResearchValue(research.privateDining)}</dd></div>
        <div><dt>Local brands found</dt><dd>{brands.length ? brands.join(', ') : 'None confirmed'}</dd></div>
      </dl>
      {research.notes ? <p><strong>Research notes</strong><br />{research.notes}</p> : null}
      {links.length ? <div className="account-research-links"><strong>Sources</strong>{links.map((url, index) => <a href={url} key={url} rel="noreferrer" target="_blank">{index === 0 && url === research.websiteUrl ? 'Website' : url === research.cocktailMenuUrl ? 'Cocktail menu' : `Source ${index + 1}`}<span className="sr-only"> (opens in a new tab)</span></a>)}</div> : <p className="muted">No source links were saved.</p>}
    </details>
  </section>;
}

function IntelligenceFacts({ facts }: { facts: Array<{ label: string; value: number | string }> }) {
  return <dl className="account-intelligence-facts">
    {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
  </dl>;
}

function OpportunityRow({
  accountHref,
  accountName,
  explanation,
  scoredAt,
  priorityBand,
  productionScore,
  recommendedAction,
  scoringVersion,
  title,
  actions,
}: {
  accountHref?: string;
  accountName?: string;
  explanation: Prisma.JsonValue;
  scoredAt?: Date;
  priorityBand: string;
  productionScore?: number;
  recommendedAction: string;
  scoringVersion?: string;
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
        {productionScore !== undefined ? <span aria-label={`Opportunity score ${Math.round(productionScore)} out of 100`} className="account-opportunity-score"><strong>{Math.round(productionScore)}</strong> {scoringVersion?.startsWith('RESEARCH_FIT_') ? 'provisional' : 'score'}</span> : null}
      </div>
      <span className="account-opportunity-next"><strong>Next</strong> {recommendedAction}</span>
    </div>
    {actions}
    <details className="opportunity-evidence compact-details nested-details">
      <summary>How this score was calculated</summary>
      {productionScore !== undefined && scoredAt && scoringVersion
        ? <ScoreBreakdown explanation={explanation} score={productionScore} scoredAt={scoredAt} scoringVersion={scoringVersion} />
        : <p>{firstExplanation(explanation)}</p>}
    </details>
  </article>;
}

export async function OpportunityAccountPanel({ agencyId, wholesaleAccountId, currentUserId, users, returnTo }: { agencyId?: string; wholesaleAccountId?: string; currentUserId: string; users: Array<{ id: string; name: string }>; returnTo?: string }) {
  const user = await getCurrentUser();
  const context = user ? await getOrganizationContext(user) : null;
  if (!context || !(await hasFeature(context.organizationId, 'WHOLESALE_OPPORTUNITIES'))) return null;
  const organizationId = context.organizationId;
  const tenantConfig = await getOrganizationTenantConfig(organizationId);
  const isAgencyRollup = Boolean(agencyId && !wholesaleAccountId);
  const opportunityWhere: Prisma.SalesOpportunityWhereInput = wholesaleAccountId
    ? { organizationId, wholesaleAccountId, status: { in: activeStatuses } }
    : { organizationId, status: { in: activeStatuses }, wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' } } };
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
        include: { scores: { orderBy: { scoredAt: 'desc' }, select: { factors: true, scoredAt: true }, take: 1 }, wholesaleAccount: { select: { id: true, name: true } } },
        orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
        take: 12,
      }),
      prisma.worklistItem.count({
        where: {
          organizationId,
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
    const salesByAccount = summarizeLinkedWholesaleAccountSales({ accounts: linkedAccounts, config: tenantConfig, rows: salesRows });
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
        { label: 'In progress', value: pursuing },
        { label: 'Follow-ups', value: openFollowUps },
        { label: 'Linked accounts', value: linkedAccounts.length },
        { label: 'Buying / 30d', value: buyingAccounts },
        { label: `${tenantConfig.productLabel} bottles / 30d`, value: echoBottles30 },
        { label: 'All bottles / 30d', value: allBottles30 },
      ]} />
      {accountSales.slice(0, 12).map(({ account, sales }) => {
        const opportunity = opportunityByAccount.get(account.id);
        const salesExplanation = `${sales.echoBottles} Echo · ${sales.allBottles} total bottles in 30 days`;
        return <OpportunityRow
          accountHref={`/wholesale/${account.id}`}
          accountName={account.name}
          explanation={opportunity ? opportunity.scores[0]?.factors ?? opportunity.explanation : [salesExplanation]}
          key={account.id}
          priorityBand={opportunity?.priorityBand ?? (sales.echoBottles > 0 ? 'MEDIUM' : 'LOW')}
          productionScore={opportunity?.productionScore}
          recommendedAction={opportunity?.recommendedAction ?? (sales.echoBottles > 0 ? 'Maintain relationship' : 'Review account')}
          scoredAt={opportunity?.scores[0]?.scoredAt ?? opportunity?.lastDetectedAt}
          scoringVersion={opportunity?.scoringVersion}
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

  const [opportunities, sales, visits, worklist, research, account] = await Promise.all([
    prisma.salesOpportunity.findMany({
      where: opportunityWhere,
      include: { scores: { orderBy: { scoredAt: 'desc' }, select: { factors: true, scoredAt: true }, take: 1 }, wholesaleAccount: { select: { id: true, name: true } } },
      orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
      take: 5,
    }),
    prisma.accountSalesEvent.findMany({
      where: { organizationId, wholesaleAccountId, ...getTenantAccountSalesEventWhere(tenantConfig) },
      orderBy: { reportDate: 'desc' },
      take: 30,
    }),
    prisma.loggedVisit.findMany({ where: { organizationId, wholesaleAccountId, locationType: 'wholesale' }, orderBy: { visitAt: 'desc' }, take: 20, select: { id: true, visitAt: true, summary: true, createdBy: true } }),
    prisma.worklistItem.findMany({ where: { organizationId, wholesaleAccountId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { dueDate: 'asc' }, take: 10, select: { id: true, title: true, dueDate: true, salesOpportunityId: true } }),
    prisma.targetPublicResearch.findUnique({
      where: { wholesaleAccountId },
      select: { buyerStructure: true, cocktailMenuUrl: true, cocktailProgram: true, events: true, googleRating: true, googleReviewCount: true, identitySnapshot: true, isNationalChain: true, localBrandsOnMenu: true, notes: true, openStatus: true, ownershipVerification: true, patioOutdoor: true, popularitySignal: true, privateDining: true, researchConfidence: true, sourceUrls: true, updatedAt: true, websiteUrl: true, yelpRating: true, yelpReviewCount: true },
    }),
    prisma.wholesaleAccount.findUnique({ where: { id: wholesaleAccountId }, select: { state: true } }),
  ]);
  const researchOnly = isOutsideOhio(account?.state);
  const timeline = [
    ...sales.map((event) => ({ at: event.reportDate, kind: 'purchase', title: `${event.itemCode} - ${event.itemName}`, detail: `${event.bottles} bottle${event.bottles === 1 ? '' : 's'} purchased` })),
    ...visits.map((visit) => ({ at: visit.visitAt, kind: 'visit', title: `${visit.createdBy ?? 'Team member'} visited`, detail: visit.summary ?? 'Visit logged' })),
    ...opportunities.map((item) => ({ at: item.detectedAt, kind: 'opportunity', title: `${item.title} detected`, detail: item.recommendedAction })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 40);
  const tenantBottles90 = sales.filter((event) => event.reportDate >= new Date(Date.now() - 90 * 86_400_000)).reduce((sum, event) => sum + event.bottles, 0);
  return <>
    <section className="card account-opportunity-panel"><div className="section-heading account-opportunity-heading"><div><span className="page-eyebrow">Why care right now?</span><h2>Opportunity intelligence</h2></div><Link className="btn secondary compact-btn" href="/opportunities">View inbox</Link></div>
      <IntelligenceFacts facts={[
        { label: 'Active', value: opportunities.length },
        { label: `${tenantConfig.productLabel} bottles / 90d`, value: researchOnly ? 'Unavailable' : tenantBottles90 },
        { label: 'Last visit', value: visits[0] ? formatEasternDate(visits[0].visitAt) : 'Never' },
        { label: 'Follow-ups', value: worklist.length },
      ]} />
      <ResearchSummary research={research} researchOnly={researchOnly} />
      {opportunities.slice(0, 3).map((item) => <OpportunityRow
        explanation={item.scores[0]?.factors ?? item.explanation}
        key={item.id}
        priorityBand={item.priorityBand}
        productionScore={item.productionScore}
        recommendedAction={item.recommendedAction}
        scoredAt={item.scores[0]?.scoredAt ?? item.lastDetectedAt}
        scoringVersion={item.scoringVersion}
        title={item.title}
        actions={<ContextualActions
          context={{ accountName: item.wholesaleAccount.name, opportunityId: item.id, reason: firstExplanation(item.explanation), returnTo: `/wholesale/${wholesaleAccountId}`, sourceLabel: item.title, sourceType: item.type, wholesaleAccountId }}
          currentUserId={currentUserId}
          existingFollowUpId={worklist.find((task) => task.salesOpportunityId === item.id)?.id}
          users={users}
        />}
      />)}
      {opportunities.length === 0 ? <p className="muted activity-empty">No active Opportunities for this account.</p> : null}
    </section>
    <section className="dashboard-section unified-timeline">
      <div className="section-heading"><div><h2>Activity + sales timeline</h2><span className="muted timeline-count">{timeline.length} events</span></div><DataFreshnessBadge datePrefix="Purchases through" sourceDate={sales[0]?.reportDate} /></div>
      <details className="source-explanation compact-details nested-details">
        <summary>Why purchase totals may differ</summary>
        <p>Purchase entries here include your organization&apos;s tracked products from the sales timeline. The Recent OHLQ Purchases card includes all matched vendors for this account, so it can show a larger total. Visits, tasks, and opportunity events use their own activity dates and may be newer than the latest OHLQ report.</p>
      </details>
      {timeline.map((event, index) => <article className={`timeline-event timeline-${event.kind}`} key={`${event.kind}-${event.at.toISOString()}-${index}`}><time>{formatEasternDate(event.at)}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}
      {timeline.length === 0 ? <p className="card muted activity-empty">No account activity is available yet.</p> : null}
    </section>
  </>;
}
