import { CommercialOpportunityStars } from '../components/CommercialOpportunityStars';
import { evidenceModeLabel, type EvidenceMode } from '../../lib/wholesaleAssessment';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OpportunityStatus, WorklistStatus } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { formatWorklistDue } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../lib/organizations';
import { AccountViewNavigation } from '../components/AccountViewNavigation';
import { GlobalSearchForm } from '../components/GlobalSearchForm';

export const metadata = buildPageMetadata('Search');

const resultLimit = 12;
const inactiveWorkStatuses = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const hasWholesaleOpportunities = (await getOrganizationFeatures(organizationId)).has('WHOLESALE_OPPORTUNITIES');
  const params = (await searchParams) ?? {};
  const query = (params.q ?? '').trim();
  const canSearch = query.length >= 2;

  const [agencies, wholesaleAccounts, workItems] = canSearch
    ? await Promise.all([
        prisma.agency.findMany({
          take: resultLimit,
          where: {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { agencyId: { contains: query, mode: 'insensitive' } },
              { address: { contains: query, mode: 'insensitive' } },
              { city: { contains: query, mode: 'insensitive' } },
              { primaryContact: { contains: query, mode: 'insensitive' } },
            ],
          },
          orderBy: [{ name: 'asc' }],
          select: { id: true, agencyId: true, name: true, address: true, city: true },
        }),
        prisma.wholesaleAccount.findMany({
          take: resultLimit,
          where: {
            isActive: true,
            mergedIntoId: null,
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { licenseeId: { contains: query, mode: 'insensitive' } },
              { agencyId: { contains: query, mode: 'insensitive' } },
              { address: { contains: query, mode: 'insensitive' } },
              { city: { contains: query, mode: 'insensitive' } },
              { ownership: { contains: query, mode: 'insensitive' } },
              { licenseeIds: { some: { licenseeId: { contains: query, mode: 'insensitive' } } } },
              ...(hasWholesaleOpportunities ? [
                { opportunities: { some: { organizationId, title: { contains: query, mode: 'insensitive' as const } } } },
                { opportunities: { some: { organizationId, recommendedAction: { contains: query, mode: 'insensitive' as const } } } },
                { opportunities: { some: { organizationId, targetCategory: { contains: query, mode: 'insensitive' as const } } } },
              ] : []),
            ],
          },
          orderBy: [{ name: 'asc' }],
          select: {
            id: true,
            agencyId: true,
            licenseeId: true,
            name: true,
            address: true,
            city: true,
            currentAssessments: {
              where: { organizationId },
              take: 1,
              select: { rating: true, assessmentStatus: true, refreshRequestedAt: true, calculatedAt: true, action: true, evidenceMode: true },
            },
          },
        }),
        prisma.worklistItem.findMany({
          take: resultLimit,
          where: {
            organizationId,
            status: { notIn: inactiveWorkStatuses },
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { detail: { contains: query, mode: 'insensitive' } },
              { assignedTo: { contains: query, mode: 'insensitive' } },
            ],
          },
          orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
          select: { id: true, title: true, detail: true, category: true, dueDate: true, dueTimeMinutes: true, status: true },
        }),
      ])
    : [[], [], []];

  const totalResults = agencies.length + wholesaleAccounts.length + workItems.length;

  return (
    <>
      <header className="page-heading page-header search-heading">
        <div>

          <h1>Find accounts and work</h1>
          <p className="muted">Search retail accounts, restaurant accounts, active Opportunities, and work in one place.</p>
        </div>
      </header>

      <AccountViewNavigation active="overview" />

      <GlobalSearchForm defaultValue={query} />

      {!canSearch ? (
        <section className="card search-empty-state">
          <h2>Search across Neat</h2>
          <p className="muted">Enter at least two characters. Names, IDs, addresses, cities, contacts, and task details are searchable.</p>
        </section>
      ) : totalResults === 0 ? (
        <section className="card search-empty-state">
          <h2>No results for “{query}”</h2>
          <p className="muted">Try an account ID, a shorter business name, a city, or a task keyword.</p>
        </section>
      ) : (
        <div className="search-results">
          <div className="section-heading">
            <h2>Results</h2>
            <span className="pill">{totalResults}</span>
          </div>

          {agencies.length > 0 ? (
            <section className="search-result-group">
              <h3>Retail <span>{agencies.length}</span></h3>
              <div className="search-result-list">
                {agencies.map((agency) => (
                  <Link className="search-result-row" href={`/agencies/${agency.id}`} key={agency.id}>
                    <span><strong>{agency.name}</strong><small>{[agency.address, agency.city].filter(Boolean).join(', ') || 'No address'}</small></span>
                    <span><small>Retail</small><strong>{agency.agencyId}</strong></span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {wholesaleAccounts.length > 0 ? (
            <section className="search-result-group">
              <h3>Restaurant Accounts <span>{wholesaleAccounts.length}</span></h3>
              <div className="search-result-list">
                {wholesaleAccounts.map((account) => (
                  <Link className="search-result-row" href={`/wholesale/${account.id}`} key={account.id}>
                    <span><strong>{account.name}</strong><small>{[account.address, account.city].filter(Boolean).join(', ') || 'No address'}</small></span>
                    <span>
                      {hasWholesaleOpportunities ? <span><CommercialOpportunityStars rating={account.currentAssessments[0]?.rating} status={account.currentAssessments[0]?.assessmentStatus ?? 'PENDING'} pending={Boolean(account.currentAssessments[0]?.refreshRequestedAt)} stale={Boolean(account.currentAssessments[0] && Date.now() - account.currentAssessments[0].calculatedAt.getTime() > 48 * 3_600_000)} />{account.currentAssessments[0] ? <small>{evidenceModeLabel[account.currentAssessments[0].evidenceMode as EvidenceMode]}</small> : null}</span> : <small>Restaurants</small>}
                      <strong>{account.licenseeId}</strong>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {workItems.length > 0 ? (
            <section className="search-result-group">
              <h3>Active Work <span>{workItems.length}</span></h3>
              <div className="search-result-list">
                {workItems.map((item) => (
                  <Link className="search-result-row" href={`/alerts?q=${encodeURIComponent(item.title)}`} key={item.id}>
                    <span><strong>{item.title}</strong><small>{item.detail || 'No additional detail'}</small></span>
                    <span><small>{item.category.toLowerCase()}</small><strong>{formatWorklistDue(item.dueDate, item.dueTimeMinutes) || 'No due date'}</strong></span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
