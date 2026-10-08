export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { requireUser, getUserDisplayName } from '../../lib/auth';
import { requireFeatureForUser } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';
import { buildPageMetadata } from '../../lib/appBrand';
import { evidenceModeLabel, readAssessment } from '../../lib/wholesaleAssessment';
import { opportunityTerritoryAccountWhere, isOpportunityTerritorySlug, OPPORTUNITY_TERRITORIES } from '../../lib/opportunityTerritories';
import { normalizeUsState } from '../../lib/usStates';
import { WholesaleAssessmentSummary } from '../components/WholesaleAssessmentSummary';
import { ContextualActions } from '../components/ContextualActions';
import { ActionForm } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { OpportunitySearch } from './OpportunitySearch';
import { TargetAccountControl } from '../components/TargetAccountControl';
import { chosenPursuitWhere } from '../../lib/acceptWholesaleAssessment';
import { acceptAssessment, assessmentFeedback } from './assessmentActions';

export const metadata = buildPageMetadata('Wholesale Opportunities');
type Query = { q?: string; state?: string; priority?: string; mode?: string; sort?: string; territory?: string; page?: string; view?: string };
export default async function OpportunityInbox({ searchParams }: { searchParams?: Promise<Query> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const q = (await searchParams) ?? {};
  const search = q.q?.trim(), state = normalizeUsState(q.state);
  const territory = isOpportunityTerritorySlug(q.territory) ? q.territory : undefined;
  const mode = q.mode && Object.hasOwn(evidenceModeLabel, q.mode) ? q.mode : undefined;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const where: Prisma.WholesaleAccountAssessmentWhereInput = { organizationId, wholesaleAccount: { mergedIntoId: null,
    ...(state ? { state: { equals: state, mode: 'insensitive' } } : {}), ...(territory ? opportunityTerritoryAccountWhere(territory) : {}) },
    ...(mode ? { evidenceMode: mode } : {}), ...(q.priority === 'high' ? { priorityBand: 'HIGH' } : {}),
    ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { wholesaleAccount: { name: { contains: search, mode: 'insensitive' } } }, { wholesaleAccount: { city: { contains: search, mode: 'insensitive' } } }] } : {}) };
  const [rows, count, assignees, lastRun] = await Promise.all([
    prisma.wholesaleAccountAssessment.findMany({ where, orderBy: [{ evidenceMode: 'asc' }, { priority: q.sort === 'lowest' ? 'asc' : 'desc' }, { wholesaleAccountId: 'asc' }], skip: (page - 1) * 50, take: 50,
      include: { wholesaleAccount: { select: {
        name: true, city: true, state: true,
        opportunities: { where: { organizationId, ...chosenPursuitWhere }, take: 1,
          include: { worklistItems: { where: { status: { in: ['OPEN','IN_PROGRESS'] } }, take: 1 } } },
      } } } }),
    prisma.wholesaleAccountAssessment.count({ where }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER','PLATFORM_ADMIN'] } }, select: { id: true, name: true, email: true } }),
    prisma.wholesaleAssessmentRun.findFirst({ where: { organizationId, fullSweep: true }, orderBy: { startedAt: 'desc' } }),
  ]);
  const href = (change: Partial<Query>) => { const p = new URLSearchParams(); for (const [k,v] of Object.entries({ ...q, page: undefined, ...change })) if (v) p.set(k,v); return `/opportunities?${p}`; };
  const users = assignees.map(a => ({ id: a.id, name: getUserDisplayName(a) }));
  const targeted = new Set((await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE', externalAccountId: { in: rows.map(r => r.wholesaleAccountId) }, isTargeting: true }, select: { externalAccountId: true } })).map(r => r.externalAccountId));
  return <div className="opportunities-page">
    <header className="page-heading"><h1>Wholesale Opportunities</h1><p>Current account intelligence and the strongest supported use. Accepted pursuits keep their original context.</p><Link href="/alerts?view=pursuing">View chosen pursuits</Link>{['ADMIN','PLATFORM_ADMIN'].includes(user.role) ? <Link href="/admin/opportunity-performance">Refresh status and outcomes</Link> : null}</header>
    <OpportunitySearch value={search ?? ''} state={state ?? ''} />
    <nav aria-label="Evidence mode" className="opportunity-filters"><Link href={href({ mode: undefined })}>All evidence modes</Link>{Object.entries(evidenceModeLabel).map(([value,label]) => <Link key={value} aria-current={mode === value ? 'page' : undefined} href={href({ mode: value })}>{label}</Link>)}</nav>
    <nav aria-label="Opportunity filters" className="opportunity-filters"><Link href={href({ priority: undefined, sort: undefined })}>Highest priority</Link><Link href={href({ priority: 'high' })}>High priority</Link><Link href={href({ priority: undefined, sort: 'lowest' })}>Lowest priority</Link><Link href={href({ territory: undefined })}>All territories</Link>{OPPORTUNITY_TERRITORIES.map(t => <Link key={t.slug} href={href({ territory: t.slug })}>{t.shortLabel}</Link>)}</nav>
    <p className="muted">{count.toLocaleString()} accounts · Grouped by evidence mode, then priority. Equal scores across modes are not equal measured commercial value.</p>
    {lastRun?.status === 'PARTIAL_SOURCE' ? <p role="status">All accounts were refreshed; sales coverage is incomplete. Review each assessment’s evidence limits.</p> : lastRun?.status !== 'COMPLETED' ? <p role="status">The full refresh is {lastRun?.status === 'RUNNING' ? 'in progress' : 'due or incomplete'}. Existing assessments may be stale; check refresh status.</p> : null}
    <section aria-label="Current recommendations" className="opportunity-results">{rows.map(row => {
      const assessment = readAssessment(row.assessment), best = assessment?.candidates[0];
      const pursuit = row.wholesaleAccount.opportunities[0];
      const dismissed = Boolean(best && row.dismissedKey === best.key), snoozed = Boolean(row.snoozedUntil && row.snoozedUntil > new Date());
      return <article className="card opportunity-row" key={row.id}><h2><Link href={`/wholesale/${row.wholesaleAccountId}`}>{row.wholesaleAccount.name}</Link></h2>{targeted.has(row.wholesaleAccountId) ? <strong className="target-account-marker">TARGET ACCOUNT</strong> : null}<p className="muted">{[row.wholesaleAccount.city,row.wholesaleAccount.state].filter(Boolean).join(', ')}</p>
        <WholesaleAssessmentSummary value={row.assessment} pending={Boolean(row.refreshRequestedAt)} actions={<div className="assessment-actions">
          <TargetAccountControl accountType="WHOLESALE" externalAccountId={row.wholesaleAccountId} isTargeting={targeted.has(row.wholesaleAccountId)} returnTo={href({})} />
          {pursuit ? <p><strong>Existing pursuit:</strong> {pursuit.title} · {pursuit.status.toLowerCase()}{pursuit.worklistItems[0] ? <> · <Link href={`/alerts?task=${pursuit.worklistItems[0].id}`}>View task</Link></> : null}</p> : null}
          {dismissed || snoozed ? <p role="status">{dismissed ? `Recommendation dismissed: ${row.dismissalReason}` : `Snoozed until ${row.snoozedUntil!.toISOString().slice(0,10)}`}. Current evidence continues to refresh.</p> : null}
          {best && !pursuit && !dismissed && !snoozed && row.state === 'READY' ? <ActionForm action={acceptAssessment}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="candidateKey" value={best.key}/>{['ADMIN','PLATFORM_ADMIN'].includes(user.role) ? <label>Assign follow-up<select name="assignedToUserId" defaultValue={users.some(u => u.id === user.id) ? user.id : ''}><option value="" disabled>Choose team member</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label> : null}<SubmitButton disabled={Boolean(row.refreshRequestedAt) || !users.length}>Accept and create follow-up</SubmitButton></ActionForm> : null}
          <ContextualActions currentUserId={user.id} users={users} existingFollowUpId={pursuit?.worklistItems[0]?.id} context={{ accountName: row.wholesaleAccount.name, wholesaleAccountId: row.wholesaleAccountId, returnTo: href({}), reason: assessment?.reasons.join(' '), sourceLabel: row.title, sourceType: 'CURRENT_ASSESSMENT' }} />
          <details><summary>Recommendation feedback</summary><ActionForm action={assessmentFeedback}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="candidateKey" value={best?.key ?? ''}/><label>Reason<select name="reason">{['Wrong evidence','Wrong product','Low upside','Timing','Strategy'].map(r => <option key={r}>{r}</option>)}</select></label><SubmitButton name="action" value="dismiss" disabled={!best}>Dismiss recommendation</SubmitButton><label>Snooze until<input name="until" type="date"/></label><SubmitButton name="action" value="snooze">Snooze</SubmitButton><SubmitButton name="action" value="clear">Clear feedback</SubmitButton></ActionForm></details>
        </div>} />
      </article>;
    })}</section>
    {!rows.length ? <p className="card" role="status">No current assessments match. Clear filters or check the refresh status.</p> : null}
    <nav aria-label="Pages">{page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : null}{page * 50 < count ? <Link href={href({ page: String(page + 1) })}>Next 50</Link> : null}</nav>
  </div>;
}
