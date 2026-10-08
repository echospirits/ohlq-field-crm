import { Prisma } from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate, formatEasternDateTime } from '../../lib/dateTime';
import { getTenantAccountSalesEventWhere } from '../../lib/ohlqSalesData';
import { opportunityFactors } from '../../lib/opportunityPresentation';
import { prisma } from '../../lib/prisma';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';
import type { ReactNode } from 'react';
import { getCurrentUser } from '../../lib/auth';
import { getOrganizationContext, hasFeature } from '../../lib/organizations';
import { getOrganizationTenantConfig } from '../../lib/tenantConfig';
import { readPublicRatings, readResearchEvidence } from '../../lib/accountResearchQueue';
import { chosenPursuitWhere } from '../../lib/acceptWholesaleAssessment';
import { WholesaleAssessmentSummary } from '../components/WholesaleAssessmentSummary';


const firstExplanation = (explanation: Prisma.JsonValue) =>
  opportunityFactors(explanation)[0] ?? 'Review the current account signals.';

const displayResearchValue = (value: string | null | undefined) => value?.trim() || 'Not confirmed';

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
  lastRefreshedAt: Date | null;
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
    <div><h3>Public research</h3><p className="muted">{researchOnly ? 'Research is needed before a provisional fit score can be calculated. Add a complete street address, city, state and ZIP to make this account eligible. Purchase data is unavailable for this assessment.' : 'This account has not been researched yet. The current assessment identifies any available purchase evidence and qualification needs.'}</p></div>
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
      <small className="muted">Last researched {research.lastRefreshedAt ? formatEasternDateTime(research.lastRefreshedAt) : 'Unavailable'}</small>
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

function OpportunityRow({ explanation, recommendedAction, title, actions }: { explanation: Prisma.JsonValue; recommendedAction: string; title: string; actions?: ReactNode }) {
  return <article className="account-opportunity-row"><div className="account-opportunity-content"><strong>{title}</strong><p>{recommendedAction}</p></div>{actions}
    <details className="compact-details"><summary>Original pursuit evidence</summary><p>This is the chosen pursuit’s original context. Current account intelligence is shown above.</p><ul>{opportunityFactors(explanation).map((reason,i) => <li key={i}>{reason}</li>)}</ul></details>
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
    ? { organizationId, wholesaleAccountId, ...chosenPursuitWhere }
    : { organizationId, ...chosenPursuitWhere, wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' } } };
  if (isAgencyRollup) {
    const assessments = await prisma.wholesaleAccountAssessment.findMany({ where: { organizationId, wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' }, mergedIntoId: null } }, orderBy: [{ evidenceMode: 'asc' }, { priority: 'desc' }], take: 12, include: { wholesaleAccount: { select: { name: true } } } });
    return <section className="card"><h2>Linked wholesale intelligence</h2>{assessments.map(a => <div key={a.id}><h3><Link href={`/wholesale/${a.wholesaleAccountId}`}>{a.wholesaleAccount.name}</Link></h3><WholesaleAssessmentSummary value={a.assessment} pending={Boolean(a.refreshRequestedAt)} /></div>)}{!assessments.length ? <p>Current assessments are unavailable for linked accounts.</p> : null}</section>;
  }

  if (!wholesaleAccountId) return null;

  const [opportunities, sales, visits, worklist, research, account, currentAssessment] = await Promise.all([
    prisma.salesOpportunity.findMany({
      where: opportunityWhere,
      include: { wholesaleAccount: { select: { id: true, name: true } } },
      orderBy: { actionedAt: 'desc' },
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
      select: { buyerStructure: true, cocktailMenuUrl: true, cocktailProgram: true, events: true, googleRating: true, googleReviewCount: true, identitySnapshot: true, isNationalChain: true, localBrandsOnMenu: true, notes: true, openStatus: true, ownershipVerification: true, patioOutdoor: true, popularitySignal: true, privateDining: true, researchConfidence: true, sourceUrls: true, lastRefreshedAt: true, websiteUrl: true, yelpRating: true, yelpReviewCount: true },
    }),
    prisma.wholesaleAccount.findUnique({ where: { id: wholesaleAccountId }, select: { state: true } }),
    prisma.wholesaleAccountAssessment.findUnique({ where: { organizationId_wholesaleAccountId: { organizationId, wholesaleAccountId } } }),
  ]);
  const researchOnly = currentAssessment?.evidenceMode === 'RESEARCH_ONLY' || !currentAssessment;
  const timeline = [
    ...sales.map((event) => ({ at: event.reportDate, kind: 'purchase', title: `${event.itemCode} - ${event.itemName}`, detail: `${event.bottles} bottle${event.bottles === 1 ? '' : 's'} purchased` })),
    ...visits.map((visit) => ({ at: visit.visitAt, kind: 'visit', title: `${visit.createdBy ?? 'Team member'} visited`, detail: visit.summary ?? 'Visit logged' })),
    ...opportunities.map((item) => ({ at: item.detectedAt, kind: 'opportunity', title: `${item.title} detected`, detail: item.recommendedAction })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 40);
  return <>
    <section className="card account-opportunity-panel"><div className="section-heading account-opportunity-heading"><div><span className="page-eyebrow">Why care right now?</span><h2>Opportunity intelligence</h2></div><Link className="btn secondary compact-btn" href="/opportunities">View inbox</Link></div>
      <WholesaleAssessmentSummary value={currentAssessment?.assessment} pending={Boolean(currentAssessment?.refreshRequestedAt)} />
      <IntelligenceFacts facts={[
        { label: 'Chosen pursuits', value: opportunities.length },
        { label: 'Purchase timeline', value: 'Latest 30 entries below' },
        { label: 'Last visit', value: visits[0] ? formatEasternDate(visits[0].visitAt) : 'Never' },
        { label: 'Follow-ups', value: worklist.length },
      ]} />
      <ResearchSummary research={research} researchOnly={researchOnly} />
      {opportunities.slice(0, 3).map((item) => <OpportunityRow
        explanation={item.explanation}
        key={item.id}

        recommendedAction={item.recommendedAction}
        title={`Existing pursuit: ${item.title}`}
        actions={<ContextualActions
          context={{ accountName: item.wholesaleAccount.name, opportunityId: item.id, reason: firstExplanation(item.explanation), returnTo: `/wholesale/${wholesaleAccountId}`, sourceLabel: item.title, sourceType: item.type, wholesaleAccountId }}
          currentUserId={currentUserId}
          existingFollowUpId={worklist.find((task) => task.salesOpportunityId === item.id)?.id}
          users={users}
        />}
      />)}
      {opportunities.length === 0 ? <p className="muted activity-empty">No chosen pursuit for this account.</p> : null}
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
