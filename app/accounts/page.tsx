export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { isTasterRole } from '../../lib/userAccess';
import { AccountViewNavigation } from '../components/AccountViewNavigation';

const accountAreas = [
  {
    href: '/agencies',
    title: 'Liquor Agencies',
    description: 'Find retail agencies, review recent activity, and log account visits.',
    action: 'Browse agencies',
  },
  {
    href: '/wholesale',
    title: 'Wholesale Accounts',
    description: 'Manage on-premise accounts, sales signals, contacts, and follow-up history.',
    action: 'Browse wholesale',
  },
];

export default async function AccountsPage() {
  const user = await requireUser();
  if (isTasterRole(user.role)) redirect('/visits/new');

  return (
    <>
      <header className="page-heading page-header">
        <div>
          <span className="page-eyebrow">Accounts</span>
          <h1>Find the right account</h1>
          <p className="muted">Start with the account type, then use Opportunities to prioritize the next best work.</p>
        </div>
        <Link className="btn" href="/visits/new">Log Visit</Link>
      </header>
      <AccountViewNavigation active="overview" />

      <section className="account-area-grid" aria-label="Account areas">
        {accountAreas.map((area) => (
          <Link className="account-area-card" href={area.href} key={area.href}>
            <span className="account-area-kicker">Account workspace</span>
            <h2>{area.title}</h2>
            <p>{area.description}</p>
            <strong>{area.action} <span aria-hidden="true">→</span></strong>
          </Link>
        ))}
      </section>

      <section className="card account-support-card">
        <div>
          <span className="page-eyebrow">Supporting tools</span>
          <h2>Account organization</h2>
          <p className="muted">Manage reusable tags that help the team group and find locations.</p>
        </div>
        <div className="page-actions">
          <Link className="btn" href="/opportunities">View opportunities</Link>
          <Link className="btn secondary" href="/tags">Manage tags</Link>
        </div>
      </section>
    </>
  );
}
