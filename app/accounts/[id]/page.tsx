export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { notFound } from 'next/navigation';
import { prisma } from '../../../lib/prisma';

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await prisma.account.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } }, salesFacts: { take: 12, orderBy: { periodMonth: 'desc' } } },
  });

  if (!account) notFound();

  return (
    <>
      <h1>{account.name}</h1>
      <p className="muted">Reader-friendly account details</p>
      <div className="card">
        <div className="grid">
          <div><strong>Type:</strong> {account.type}</div>
          <div><strong>Agency ID:</strong> {account.agencyId ?? account.agencyRefId ?? '—'}</div>
          <div><strong>Licensee ID:</strong> {account.licenseeId ?? '—'}</div>
          <div><strong>Phone:</strong> {account.phone ?? '—'}</div>
          <div><strong>Address:</strong> {account.address ?? '—'}</div>
          <div><strong>City:</strong> {account.city ?? '—'}</div>
          <div><strong>County:</strong> {account.county ?? '—'}</div>
          <div><strong>Zip:</strong> {account.zip ?? '—'}</div>
          <div><strong>Primary Contact:</strong> {account.primaryContact ?? '—'}</div>
          <div><strong>Primary Contact Phone:</strong> {account.primaryContactPhone ?? '—'}</div>
          <div><strong>Warehouse:</strong> {account.warehouse ?? '—'}</div>
          <div><strong>Delivery Day:</strong> {account.deliveryDay ?? '—'}</div>
          <div><strong>Order Day:</strong> {account.orderDay ?? '—'}</div>
          <div><strong>Order Week:</strong> {account.orderWeek ?? '—'}</div>
          <div><strong>D-8 Permit:</strong> {account.d8Permit ? 'Yes' : 'No'}</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Tags</h2>
        {account.tags.length ? account.tags.map((t) => <span className="pill" key={t.tagId}>{t.tag.name}</span>) : <p className="muted">No tags yet.</p>}
      </div>
      <p style={{ marginTop: 18 }}><a className="btn" href="/accounts">Back to Accounts</a></p>
    </>
  );
}