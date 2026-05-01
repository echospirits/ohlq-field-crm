export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { prisma } from '../lib/prisma';

export default async function Dashboard() {
  const [accounts, alerts] = await Promise.all([
    prisma.account.count(),
    prisma.alert.count({ where: { status: 'OPEN' } }),
  ]);

  return (
    <>
      <h1>Daily Operating Dashboard</h1>
      <div className="grid">
        <div className="card">
          <h3>Accounts</h3>
          <p>{accounts}</p>
        </div>
        <div className="card">
          <h3>Open alerts</h3>
          <p>{alerts}</p>
        </div>
      </div>
      <div className="card">
        <h2>MVP Focus</h2>
        <p>
          Account intelligence, tags, sales data, inventory snapshots,
          lapsed-buyer alerts, and visit/photo tracking.
        </p>
      </div>
    </>
  );
}
