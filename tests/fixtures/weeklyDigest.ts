// Invented example records for rendering and delivery tests; not live tenant data.
import type { TenantWeeklyDigest } from '../../lib/weeklyDigest';
import { getWeeklyDigestWindow } from '../../lib/weeklyDigest';

export function makeTenantDigest(id = 'org_echo_spirits', name = 'Echo Spirits'): TenantWeeklyDigest {
  return {
    organization: { id, displayName: name, appName: 'Neat', digestName: 'Neat', logoUrl: null, brandPrimaryColor: '#142c32', brandAccentColor: '#146b60', timezone: 'America/New_York' },
    window: getWeeklyDigestWindow(new Date('2026-09-18T13:00:00Z')),
    sales: { retailBottles: 412, wholesaleBottles: 186, startDate: '2026-09-11', endDate: '2026-09-17', throughDate: '2026-09-17', coveredDays: 7, expectedDays: 7, configuredItems: 12, status: 'complete', retail: { sellingAgencies: 24, previousCoveredDays: 7, comparable: true, highlights: [] } },
    metrics: { visitsLogged: 8, completedWork: 6, overdue: 11, unassignedOverdue: 5, upcoming: 2, unassignedUpcoming: 0 },
    evidenceLimited: false,
    evidence: [
      { id: 'visit:harbor', kind: 'visit', account: 'Harbor Cafe', href: '/wholesale/harbor', date: '2026-09-16T19:46:00Z', owner: 'Demo Rep', text: 'Demo Buyer said seasonal spirit will be on the fall menu again and would like whiskey for the back bar.' },
      { id: 'visit:market', kind: 'visit', account: 'Demo Buyeret Hall', href: '/wholesale/market', date: '2026-09-16T21:28:00Z', owner: 'Demo Rep', text: 'Events manager interested in catering options; not the purchaser.' },
      { id: 'task:juniper', kind: 'upcoming', account: 'Juniper Grill', href: '/wholesale/juniper', date: '2026-09-21T00:00:00Z', owner: 'Demo Rep', text: 'GM welcomed a return visit to discuss partnership.' },
      { id: 'retail:agency:100', kind: 'sales', channel: 'retail', account: 'Invented North Store', href: '/agencies/north', date: '2026-09-17', owner: null, text: '100 retail bottles this week, 60 last week. Both weeks fully covered.' },
      { id: 'retail:agency:200', kind: 'sales', channel: 'retail', account: 'Invented South Store', href: '/agencies/south', date: '2026-09-17', owner: null, text: '10 retail bottles this week, 30 last week. Both weeks fully covered. No cause is known.' },
    ],
    narrative: {
      mode: 'ai', headline: 'Menu commitments and stronger retail sales mark the week, with one agency recording softer volume.',
      wins: [{ title: 'Seasonal spirit stays on the fall menu', body: 'At Harbor Cafe, the buyer reported that seasonal spirit will remain on the fall menu and expressed interest in whiskey for the back bar. No whiskey order was confirmed.', evidenceIds: ['visit:harbor'] }],
      retailWins: [{ title: 'North Store gains 40 bottles', body: 'Invented North Store recorded 100 retail bottles, up from 60 in the prior complete week.', evidenceIds: ['retail:agency:100'] }],
      risks: [],
      retailRisks: [{ title: 'South Store records lower volume', body: 'Invented South Store recorded 10 retail bottles versus 30 in the prior complete week. The records do not establish a cause or forecast a further decline.', evidenceIds: ['retail:agency:200'] }],
    },
  };
}
