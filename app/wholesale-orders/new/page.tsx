export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireUser } from '../../../lib/auth';
import { requireFeatureForUser } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { formatWholesaleLicenseeIds } from '../../../lib/wholesaleAccounts';
import { PageHeader } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Choose Wholesale Customer');

const RESULT_LIMIT = 50;

export default async function NewWholesaleOrderPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const user = await requireUser();
  await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const q = ((await searchParams)?.q ?? '').trim();
  const accounts = q ? await prisma.wholesaleAccount.findMany({
    where: {
      isActive: true,
      mergedIntoId: null,
      OR: [{ state: null }, { state: '' }, { state: { equals: 'OH', mode: 'insensitive' } }],
      AND: [{
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { ownership: { contains: q, mode: 'insensitive' } },
          { licenseeId: { contains: q, mode: 'insensitive' } },
          { licenseeIds: { some: { licenseeId: { contains: q, mode: 'insensitive' } } } },
          { address: { contains: q, mode: 'insensitive' } },
          { city: { contains: q, mode: 'insensitive' } },
        ],
      }],
    },
    include: { licenseeIds: { orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }] } },
    orderBy: [{ name: 'asc' }, { city: 'asc' }],
    take: RESULT_LIMIT,
  }) : [];

  return <>
    <PageHeader eyebrow="Wholesale orders" title="Choose a wholesale customer" description="Search active Ohio accounts by name, DBA, permit, address, or city." actions={<Link className="btn secondary" href="/wholesale-orders">Back to orders</Link>} />
    <form className="card wholesale-order-customer-search" method="get" role="search">
      <label htmlFor="wholesale-order-customer-q">Customer search</label>
      <div className="search-row">
        <input autoFocus id="wholesale-order-customer-q" name="q" placeholder="Name, permit, address, or city" type="search" defaultValue={q} />
        <button type="submit">Search</button>
      </div>
      <p className="muted">Search runs across every eligible customer before showing the first {RESULT_LIMIT} matches.</p>
    </form>
    {!q ? <article className="card empty-state"><h2>Find the customer for this order</h2><p>Enter at least part of a customer name, permit number, street, or city.</p></article> : accounts.length ? <section className="wholesale-order-customer-results" aria-label="Customer search results">
      {accounts.map((account) => <Link className="card wholesale-order-customer-card" href={`/wholesale/${account.id}/direct-order`} key={account.id}>
        <span><strong>{account.name}</strong><small>{formatWholesaleLicenseeIds(account)}</small></span>
        <span>{[account.address, account.city, account.state, account.zip].filter(Boolean).join(', ') || 'Address unavailable'}</span>
        <strong>Choose customer <span aria-hidden="true">→</span></strong>
      </Link>)}
      {accounts.length === RESULT_LIMIT ? <p className="muted">Showing the first {RESULT_LIMIT} matches. Add more detail to narrow the search.</p> : null}
    </section> : <article className="card empty-state"><h2>No eligible customers found</h2><p>Try a different name, permit number, street, or city.</p></article>}
  </>;
}
