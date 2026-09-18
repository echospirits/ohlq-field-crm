import type { TenantWeeklyDigest } from '../../lib/weeklyDigest';
import { getWeeklyDigestWindow } from '../../lib/weeklyDigest';

export function makeTenantDigest(id = 'org_echo_spirits', name = 'Echo Spirits'): TenantWeeklyDigest {
  return {
    organization: { id, displayName: name, appName: 'Neat', digestName: 'Neat', logoUrl: null, brandPrimaryColor: '#142c32', brandAccentColor: '#146b60', timezone: 'America/New_York' },
    window: getWeeklyDigestWindow(new Date('2026-09-18T13:00:00Z')),
    sales: { retailBottles: 412, wholesaleBottles: 186, startDate: '2026-09-11', endDate: '2026-09-17', throughDate: '2026-09-17', coveredDays: 7, expectedDays: 7, configuredItems: 12, status: 'complete' },
    metrics: { visitsLogged: 8, completedWork: 6, overdue: 11, unassignedOverdue: 5, upcoming: 2, unassignedUpcoming: 0 },
    evidenceLimited: false,
    evidence: [
      { id: 'visit:standardized', kind: 'visit', account: 'Standardized Brewing', href: '/wholesale/standardized', date: '2026-09-16T19:46:00Z', owner: 'James', text: 'Mark said spiced rum will be on the fall menu again and would like rye for the back bar.' },
      { id: 'visit:clocktower', kind: 'visit', account: 'Clocktower', href: '/wholesale/clocktower', date: '2026-09-16T21:28:00Z', owner: 'James', text: 'Events manager interested in catering options; not the purchaser.' },
      { id: 'task:polaris', kind: 'upcoming', account: 'Polaris Grill', href: '/wholesale/polaris', date: '2026-09-21T00:00:00Z', owner: 'James', text: 'GM welcomed a return visit to discuss partnership.' },
    ],
    narrative: {
      mode: 'ai', headline: 'A fall-menu commitment leads the week. Follow-through is the priority.',
      wins: [{ title: 'Spiced rum stays on the fall menu', body: 'At Standardized Brewing, Mark said spiced rum will be on the fall menu again and expressed interest in rye for the back bar. Confirm the placement and turn rye interest into an order.', evidenceIds: ['visit:standardized'] }],
      progress: [{ title: 'Two conversations worth advancing', body: 'Clocktower’s events manager was enthusiastic about catering support; a purchasing conversation is still needed. At Polaris Grill, the GM welcomed a return visit to discuss partnership.', evidenceIds: ['visit:clocktower', 'task:polaris'] }],
      risks: [{ title: 'Close the follow-up and ownership gaps', body: 'Eleven tasks are overdue, including five without an owner. Review priorities and assign the next action to keep account conversations moving.', evidenceIds: ['metrics'] }],
      nextWeek: [{ title: 'Confirm placements and keep appointments', body: 'Confirm Standardized’s menu placement and rye needs. Keep the Polaris Grill follow-up on September 21 and assign owners to the overdue work.', evidenceIds: ['visit:standardized', 'task:polaris', 'metrics'] }],
    },
  };
}
