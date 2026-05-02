export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { TagBadges } from '../tags/TagBadges';

const toOptional = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatDate = (date: Date | null | undefined) => (date ? new Date(date).toLocaleDateString() : '');

const getSelectedTagIds = (formData: FormData) =>
  Array.from(
    new Set(
      formData
        .getAll('tagId')
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  );

async function createWholesale(formData: FormData) {
  'use server';

  const user = await requireUser();
  const licenseeId = String(formData.get('licenseeId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (!licenseeId || !name) {
    redirect('/wholesale?status=invalid');
  }

  const tagIds = getSelectedTagIds(formData);
  const account = await prisma.wholesaleAccount.upsert({
    where: { licenseeId },
    create: {
      licenseeId,
      name,
      agencyId: toOptional(String(formData.get('agencyId') ?? '')),
      address: toOptional(String(formData.get('address') ?? '')),
      city: toOptional(String(formData.get('city') ?? '')),
      county: toOptional(String(formData.get('county') ?? '')),
      zip: toOptional(String(formData.get('zip') ?? '')),
      phone: toOptional(String(formData.get('phone') ?? '')),
      ownership: toOptional(String(formData.get('ownership') ?? '')),
      districtId: toOptional(String(formData.get('districtId') ?? '')),
      deliveryDay: toOptional(String(formData.get('deliveryDay') ?? '')),
      createdByUserId: user.id,
    },
    update: {
      name,
      agencyId: toOptional(String(formData.get('agencyId') ?? '')),
      address: toOptional(String(formData.get('address') ?? '')),
      city: toOptional(String(formData.get('city') ?? '')),
      county: toOptional(String(formData.get('county') ?? '')),
      zip: toOptional(String(formData.get('zip') ?? '')),
      phone: toOptional(String(formData.get('phone') ?? '')),
      ownership: toOptional(String(formData.get('ownership') ?? '')),
      districtId: toOptional(String(formData.get('districtId') ?? '')),
      deliveryDay: toOptional(String(formData.get('deliveryDay') ?? '')),
    },
  });

  if (tagIds.length > 0) {
    await prisma.locationTag.createMany({
      data: tagIds.map((tagId) => ({
        tagId,
        wholesaleAccountId: account.id,
        note: 'Applied from wholesale account form',
        createdByUserId: user.id,
      })),
      skipDuplicates: true,
    });
  }

  revalidatePath('/wholesale');
  revalidatePath('/tags');
  revalidatePath('/visits/new');
  redirect('/wholesale?status=saved');
}

export default async function WholesalePage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();

  const [accounts, tags] = await Promise.all([
    prisma.wholesaleAccount.findMany({
      take: 300,
      include: {
        tags: {
          include: { tag: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { licenseeId: { contains: q, mode: 'insensitive' } },
              { agencyId: { contains: q, mode: 'insensitive' } },
              { address: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
            ],
          }
        : undefined,
      orderBy: [{ name: 'asc' }, { licenseeId: 'asc' }],
    }),
    prisma.tag.findMany({ orderBy: [{ name: 'asc' }] }),
  ]);
  const accountIds = accounts.map((account) => account.id);
  const visitStats =
    accountIds.length > 0
      ? await prisma.loggedVisit.groupBy({
          by: ['wholesaleAccountId'],
          where: {
            locationType: 'wholesale',
            wholesaleAccountId: { in: accountIds },
          },
          _count: { _all: true },
          _max: { visitAt: true },
        })
      : [];
  const visitStatMap = Object.fromEntries(
    visitStats.map((stat) => [
      stat.wholesaleAccountId ?? '',
      {
        count: stat._count._all,
        lastVisitAt: stat._max.visitAt,
      },
    ]),
  );

  return (
    <>
      <h1>Wholesale Accounts</h1>
      <p className="muted">Manual creation only.</p>

      <form method="get" className="filter-form narrow-filter">
        <input name="q" defaultValue={q} placeholder="Filter name, licensee ID, agency ID, address, phone" />
      </form>
      {params.status === 'saved' ? <p className="pill">Wholesale account saved.</p> : null}
      {params.status === 'invalid' ? <p className="pill">Name and Licensee ID are required.</p> : null}

      <details className="card compact-details admin-panel">
        <summary>Create / update wholesale account</summary>
        <form action={createWholesale}>
          <div className="form-grid">
            <input name="licenseeId" placeholder="Licensee ID" required />
            <input name="name" placeholder="Name" required />
            <input name="phone" placeholder="Phone" />
            <input name="city" placeholder="City" />
          </div>
          <details className="compact-details nested-details">
            <summary>More account details</summary>
            <div className="form-grid">
              <input name="agencyId" placeholder="Agency ID" />
              <input name="address" placeholder="Address" />
              <input name="county" placeholder="County" />
              <input name="zip" placeholder="Zip" />
              <input name="ownership" placeholder="Ownership" />
              <input name="districtId" placeholder="District ID" />
              <input name="deliveryDay" placeholder="Delivery Day" />
            </div>
          </details>
          {tags.length > 0 ? (
            <details className="compact-details nested-details">
              <summary>Tags</summary>
              <div className="tag-checkbox-grid">
                {tags.map((tag) => (
                  <label className="tag-checkbox" key={tag.id}>
                    <input name="tagId" type="checkbox" value={tag.id} />
                    <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <button type="submit">Save wholesale account</button>
        </form>
      </details>

      <table className="responsive-table">
        <thead>
          <tr>
            <th>Actions</th>
            <th>Licensee ID</th>
            <th>Name</th>
            <th>Agency ID</th>
            <th>Address</th>
            <th>City</th>
            <th>Phone</th>
            <th>Tags</th>
            <th>Logged Visits</th>
            <th>Most Recent Visit</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const stats = visitStatMap[account.id] ?? { count: 0, lastVisitAt: null };

            return (
              <tr key={account.id}>
                <td data-label="Actions">
                  <Link className="btn compact-btn" href={`/visits/new?type=wholesale&wholesaleAccountId=${account.id}`}>
                    Log Visit
                  </Link>
                </td>
                <td data-label="Licensee ID">{account.licenseeId}</td>
                <td data-label="Name">
                  <Link className="table-link" href={`/wholesale/${account.id}`}>
                    {account.name}
                  </Link>
                </td>
                <td data-label="Agency ID">{account.agencyId}</td>
                <td data-label="Address">{account.address}</td>
                <td data-label="City">{account.city}</td>
                <td data-label="Phone">{account.phone}</td>
                <td data-label="Tags">
                  <TagBadges tags={account.tags.map((assignment) => assignment.tag)} />
                </td>
                <td data-label="Logged Visits">{stats.count}</td>
                <td data-label="Most Recent Visit">{formatDate(stats.lastVisitAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
