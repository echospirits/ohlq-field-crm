export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requirePlatformAdmin } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Organizations');

export default async function OrganizationsPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  await requirePlatformAdmin();
  const q = String((await searchParams)?.q ?? '').trim();
  const organizations = await prisma.organization.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { vendorIdentifiers: { some: { vendorId: { contains: q, mode: 'insensitive' } } } }] } : undefined,
    include: { vendorIdentifiers: { where: { active: true } }, features: { where: { enabled: true } } },
    orderBy: [{ active: 'desc' }, { displayName: 'asc' }],
  });
  const admins = await prisma.user.findMany({ where: { organizationId: { in: organizations.map((item) => item.id) }, role: 'ADMIN' }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: { organizationId: true, email: true, name: true } });
  const adminByOrganization = new Map(admins.map((admin) => [admin.organizationId, admin]));

  return <>
    <PageHeader eyebrow="Platform" title="Organizations" description="Search, inspect, enable, and support every Neat customer." actions={<Link className="btn" href="/platform/organizations/new">New organization</Link>} />
    <form className="card platform-search" method="get"><label>Live organization search<input autoFocus defaultValue={q} name="q" placeholder="Name, slug, or Vendor ID" /></label><button type="submit">Search</button>{q ? <Link className="btn secondary" href="/platform/organizations">Clear</Link> : null}</form>
    <div className="table-wrap"><table><thead><tr><th>Organization</th><th>Market</th><th>Primary admin</th><th>Status</th><th>Features</th><th>Vendor IDs</th><th>Onboarding</th><th>Created</th><th>Actions</th></tr></thead><tbody>{organizations.map((organization) => { const admin = adminByOrganization.get(organization.id); return <tr key={organization.id}><td><strong>{organization.displayName}</strong><small className="table-subtitle">{organization.slug}</small></td><td>{organization.primaryState}</td><td>{admin?.name || admin?.email || 'Not assigned'}</td><td>{organization.active ? organization.accountStatus : 'DISABLED'}</td><td>{organization.features.length}</td><td>{organization.vendorIdentifiers.map((item) => item.vendorId).join(', ') || '—'}</td><td>{organization.onboardingStatus}</td><td>{organization.createdAt.toISOString().slice(0, 10)}</td><td><div className="inline-actions"><Link href={`/platform/organizations/${organization.id}`}>Open</Link><form action={`/platform/support-view/${organization.id}`} method="post"><button className="link-button" type="submit">Support view</button></form></div></td></tr>; })}</tbody></table></div>
  </>;
}
