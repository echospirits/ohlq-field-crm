import { AlertStatus, TargetOpportunityStatus, WorklistStatus } from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';

const toNumber = (value: unknown) => Number(value ?? 0);

export async function TargetIntelligencePanel({ wholesaleAccountId }: { wholesaleAccountId: string }) {
  const [profile, latestScore, previousScore, latestMetric, research, opportunities, heatAlerts, worklistItems] =
    await Promise.all([
      prisma.targetAccountProfile.findUnique({
        where: { wholesaleAccountId },
        include: { ownershipGroup: true },
      }),
      prisma.targetAccountScoreHistory.findFirst({
        where: { wholesaleAccountId },
        orderBy: { scoringDate: 'desc' },
      }),
      prisma.targetAccountScoreHistory.findFirst({
        where: { wholesaleAccountId },
        orderBy: { scoringDate: 'desc' },
        skip: 1,
      }),
      prisma.targetAccountMetric.findFirst({
        where: { wholesaleAccountId },
        orderBy: { periodEnd: 'desc' },
      }),
      prisma.targetPublicResearch.findUnique({ where: { wholesaleAccountId } }),
      prisma.targetSkuOpportunity.findMany({
        where: {
          wholesaleAccountId,
          status: { in: [TargetOpportunityStatus.OPEN, TargetOpportunityStatus.IN_PROGRESS] },
        },
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
      }),
      prisma.targetHeatLossAlert.findMany({
        where: { wholesaleAccountId, status: AlertStatus.OPEN },
        orderBy: [{ severity: 'asc' }, { updatedAt: 'desc' }],
        take: 6,
      }),
      prisma.worklistItem.findMany({
        where: {
          wholesaleAccountId,
          status: { notIn: [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED] },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

  if (!profile) {
    return null;
  }

  const currentScore = toNumber(profile.currentScore);
  const scoreDelta =
    latestScore && previousScore ? toNumber(latestScore.blendedScore) - toNumber(previousScore.blendedScore) : null;
  const primaryOpportunity = opportunities[0];

  return (
    <section className="dashboard-section target-intelligence-section">
      <div className="section-heading">
        <h2>Target Intelligence</h2>
        <span className="pill">{profile.currentPriorityTier ?? 'Unscored'}</span>
        {profile.ownershipGroup ? <span className="pill">{profile.ownershipGroup.name}</span> : null}
        <a className="btn compact-btn secondary" href={`/api/target-accounts/${wholesaleAccountId}/briefing`}>
          Briefing JSON
        </a>
      </div>

      <div className="grid account-summary-grid">
        <div className="card metric-card">
          <h3>Opportunity score</h3>
          <p className="metric-value">{currentScore.toFixed(1)}</p>
          <p className="muted metric-caption">
            Rank {profile.currentRank ?? 'n/a'} · Scored {formatEasternDate(profile.lastScoredAt)}
          </p>
          {scoreDelta !== null ? (
            <p className={scoreDelta >= 0 ? 'success-text' : 'danger-text'}>
              {scoreDelta >= 0 ? '+' : ''}
              {scoreDelta.toFixed(1)} vs prior run
            </p>
          ) : null}
        </div>

        <div className="card target-next-action-card">
          <h3>Primary next action</h3>
          <strong>{worklistItems[0]?.title ?? profile.recommendedNextAction ?? 'Set a next action'}</strong>
          <p className="muted">{worklistItems[0]?.detail ?? profile.reason}</p>
          <div className="action-row">
            <Link className="btn compact-btn" href={`/visits/new?type=wholesale&wholesaleAccountId=${wholesaleAccountId}`}>
              Log visit
            </Link>
            <Link className="btn compact-btn secondary" href="/targets">
              Queue
            </Link>
          </div>
        </div>

        <div className="card account-detail-list">
          <h3>Why this account matters</h3>
          <p>
            <strong>Explanation</strong>
            <span>{profile.reason}</span>
          </p>
          <p>
            <strong>Opportunity focus</strong>
            <span>{profile.primaryOpportunity ?? primaryOpportunity?.category ?? 'Review account fit'}</span>
          </p>
          <p>
            <strong>Primary opportunity</strong>
            <span>{profile.primaryOpportunity ?? primaryOpportunity?.category}</span>
          </p>
        </div>
      </div>

      <div className="grid target-detail-grid">
        <div className="card">
          <h3>Score Components</h3>
          <dl className="detail-list">
            <div>
              <dt>Data score</dt>
              <dd>{toNumber(latestScore?.dataScore).toFixed(1)}</dd>
            </div>
            <div>
              <dt>Public fit</dt>
              <dd>{latestScore?.publicFitScore ? toNumber(latestScore.publicFitScore).toFixed(1) : 'Not researched'}</dd>
            </div>
            <div>
              <dt>Momentum</dt>
              <dd>{latestScore?.momentumScore ? toNumber(latestScore.momentumScore).toFixed(1) : 'n/a'}</dd>
            </div>
            <div>
              <dt>Expansion score</dt>
              <dd>{latestScore?.expansionScore ? toNumber(latestScore.expansionScore).toFixed(1) : 'n/a'}</dd>
            </div>
            <div>
              <dt>Research status</dt>
              <dd>{profile.researchStatus ?? 'Not set'}</dd>
            </div>
          </dl>
        </div>

        {latestMetric ? (
          <div className="card">
            <h3>Velocity and Category Fit</h3>
            <dl className="detail-list">
              <div>
                <dt>Total 9L / Avg monthly</dt>
                <dd>
                  {toNumber(latestMetric.total9LCases).toFixed(1)} / {toNumber(latestMetric.avgMonthly9L).toFixed(1)}
                </dd>
              </div>
              <div>
                <dt>Price-fit 9L / share</dt>
                <dd>
                  {toNumber(latestMetric.priceFit9L).toFixed(1)} / {toNumber(latestMetric.priceFitPercent).toFixed(1)}%
                </dd>
              </div>
              <div>
                <dt>Whiskey / Rum / Vodka / Cordial</dt>
                <dd>
                  {toNumber(latestMetric.americanWhiskey9L).toFixed(1)} / {toNumber(latestMetric.rum9L).toFixed(1)} /{' '}
                  {toNumber(latestMetric.vodka9L).toFixed(1)} / {toNumber(latestMetric.cordial9L).toFixed(1)}
                </dd>
              </div>
              <div>
                <dt>ETOHIO 9L</dt>
                <dd>{toNumber(latestMetric.etohioVolume9L).toFixed(1)}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div className="card">
          <h3>Go Deeper</h3>
          <dl className="detail-list">
            <div>
              <dt>Current categories</dt>
              <dd>{Array.isArray(profile.currentEtohioCategories) ? profile.currentEtohioCategories.join(', ') : 'None imported'}</dd>
            </div>
            <div>
              <dt>Missing categories</dt>
              <dd>{Array.isArray(profile.missingCategories) ? profile.missingCategories.join(', ') : 'None imported'}</dd>
            </div>
            <div>
              <dt>Strongest next category</dt>
              <dd>{profile.strongestNextCategory ?? 'Review portfolio fit'}</dd>
            </div>
          </dl>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Opportunity Evidence</h2>
          <span className="pill">{opportunities.length}</span>
        </div>
        <div className="target-opportunity-list">
          {opportunities.map((opportunity) => (
            <article className="card target-opportunity-card" key={opportunity.id}>
              <div>
                <div className="inline-meta">
                  <span className="pill">{opportunity.opportunityType.replace(/_/g, ' ')}</span>
                  <span className="pill">{opportunity.confidence ?? 'Confidence n/a'}</span>
                </div>
                <h3>{opportunity.category ?? opportunity.productName}</h3>
                <p className="muted">{opportunity.recommendedNextAction}</p>
              </div>
              <strong>{opportunity.score ? toNumber(opportunity.score).toFixed(1) : 'n/a'}</strong>
              <ul className="plain-list">
                {Array.isArray(opportunity.supportingReasons)
                  ? opportunity.supportingReasons.map((reason, index) => <li key={index}>{String(reason)}</li>)
                  : null}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Public Research</h2>
          <span className="pill">{research?.lastRefreshedAt ? `Refreshed ${formatEasternDate(research.lastRefreshedAt)}` : research?.refreshStatus ?? 'Awaiting weekly refresh'}</span>
        </div>
        <div className="card account-detail-list">
          <p>
            <strong>Patio</strong>
            <span>{research?.patioOutdoor ?? 'Unknown'}</span>
          </p>
          <p>
            <strong>Cocktails</strong>
            <span>{research?.cocktailProgram ?? 'Unknown'}</span>
          </p>
          <p>
            <strong>Events</strong>
            <span>{research?.events ?? 'Unknown'}</span>
          </p>
          <p>
            <strong>Popularity</strong>
            <span>{research?.popularitySignal ?? 'Unknown'}</span>
          </p>
          <p>
            <strong>Google</strong>
            <span>{research?.googleRating ? `${toNumber(research.googleRating).toFixed(1)} · ${research.googleReviewCount ?? 'Unknown'} reviews` : 'Not captured'}</span>
          </p>
          <p>
            <strong>Yelp</strong>
            <span>{research?.yelpRating ? `${toNumber(research.yelpRating).toFixed(1)} · ${research.yelpReviewCount ?? 'Unknown'} reviews` : 'Not captured'}</span>
          </p>
          <p>
            <strong>National chain</strong>
            <span>{research?.isNationalChain === null || research?.isNationalChain === undefined ? 'Not verified' : research.isNationalChain ? 'Yes — deprioritize' : 'No'}</span>
          </p>
          <p>
            <strong>Local brands on menu</strong>
            <span>{Array.isArray(research?.localBrandsOnMenu) && research.localBrandsOnMenu.length ? research.localBrandsOnMenu.map(String).join(', ') : 'Not captured'}</span>
          </p>
          <p>
            <strong>Website / cocktail menu</strong>
            <span>{research?.websiteUrl ? <Link href={research.websiteUrl}>Website</Link> : 'Not captured'}{research?.cocktailMenuUrl ? <> · <Link href={research.cocktailMenuUrl}>Cocktail menu</Link></> : null}</span>
          </p>
          <p>
            <strong>Notes</strong>
            <span>{research?.notes ?? 'No research notes imported yet.'}</span>
          </p>
          <p>
            <strong>Confidence / source</strong>
            <span>{research?.researchConfidence ?? 'Not rated'} · {research?.researcher ?? 'Imported research'}</span>
          </p>
          {Array.isArray(research?.sourceUrls) && research.sourceUrls.length ? (
            <p>
              <strong>Evidence</strong>
              <span>{research.sourceUrls.slice(0, 5).map((url, index) => <span key={String(url)}>{index ? ' · ' : ''}<Link href={String(url)}>Source {index + 1}</Link></span>)}</span>
            </p>
          ) : null}
        </div>
      </section>

      {heatAlerts.length > 0 ? (
        <section className="dashboard-section">
          <div className="section-heading">
            <h2>Heat-loss Alerts</h2>
            <span className="pill">{heatAlerts.length}</span>
          </div>
          <div className="target-alert-list">
            {heatAlerts.map((alert) => (
              <div className="card target-alert-card" key={alert.id}>
                <strong>{alert.title}</strong>
                <span className="pill">{alert.severity}</span>
                <p className="muted">{alert.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
