export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { requirePlatformAdmin } from '../../lib/auth';
import { INTELLIGENCE_PACKAGE_FEATURE_KEYS, hasIntelligencePackage } from '../../lib/featureRegistry';
import { prisma } from '../../lib/prisma';
import { PageHeader } from '../components/PageChrome';

export const metadata = buildPageMetadata('Platform');

export default async function PlatformDashboard() {
  await requirePlatformAdmin();
  const [total, active, onboarding, disabled, recent, intelligenceOrganizations, importHealth] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } } }),
    prisma.organization.count({ where: { onboardingStatus: { not: 'READY' } } }),
    prisma.organization.count({ where: { OR: [{ active: false }, { accountStatus: { in: ['SUSPENDED', 'CANCELLED'] } }] } }),
    prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 6, include: { vendorIdentifiers: { where: { active: true } }, features: { where: { enabled: true } } } }),
    prisma.organizationFeature.findMany({ where: { enabled: true, featureKey: { in: [...INTELLIGENCE_PACKAGE_FEATURE_KEYS] } }, distinct: ['organizationId'], select: { organizationId: true } }),
    prisma.ohlqReportImportStatus.findMany({ orderBy: { startedAt: 'desc' }, take: 3 }),
  ]);
  return <>
    <PageHeader eyebrow="Neat platform" title="Platform administration" description="Provision organizations, control entitlements, and inspect onboarding and shared-data health." actions={<Link className="btn" href="/platform/organizations/new">New organization</Link>} />
    <section className="platform-metrics" aria-label="Organization totals">
      {[['Organizations', total], ['Active', active], ['Onboarding', onboarding], ['Disabled', disabled]].map(([label, value]) => <article className="card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>
    <section className="platform-grid">
      <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Customers</span><h2>Recent organizations</h2></div><Link href="/platform/organizations">View all</Link></div>
        <div className="platform-list">{recent.map((organization) => <Link href={`/platform/organizations/${organization.id}`} key={organization.id}><span><strong>{organization.displayName}</strong><small>{organization.primaryState} · {organization.vendorIdentifiers.map((item) => item.vendorId).join(', ') || 'No Vendor ID'}</small></span><span className="pill">{hasIntelligencePackage(organization.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey)) ? 'Core + Intelligence' : 'Core'}</span></Link>)}</div>
      </article>
      <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Packaging</span><h2>Plans</h2></div></div>
        <div className="platform-list"><div><span><strong>Core CRM</strong><small>Included for every organization</small></span><span>{total} orgs</span></div><div><span><strong>Intelligence</strong><small>Optional add-on</small></span><span>{intelligenceOrganizations.length} orgs</span></div></div>
      </article>
      <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Shared Ohio data</span><h2>Import health</h2></div><Link href="/admin/data-status">Details</Link></div>
        <div className="platform-list">{importHealth.map((run) => <div key={run.id}><span><strong>{run.dataSource.replaceAll('_', ' ')}</strong><small>{run.reportDate.toISOString().slice(0, 10)}</small></span><span className="pill">{run.status}</span></div>)}</div>
      </article>
    </section>
  </>;
}
