export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { WorklistStatus } from '@prisma/client';
import { requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';

export default async function Dashboard() {
  await requireUser();

  const [accounts, worklistItems] = await Promise.all([
    prisma.account.count(),
    prisma.worklistItem.count({
      where: { status: { notIn: [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED] } },
    }),
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
          <h3>Active worklist</h3>
          <p>{worklistItems}</p>
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
