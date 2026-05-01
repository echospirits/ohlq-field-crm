export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';

const statusLabels: Record<WorklistStatus, string> = {
  [WorklistStatus.OPEN]: 'Open',
  [WorklistStatus.IN_PROGRESS]: 'In progress',
  [WorklistStatus.COMPLETED]: 'Completed',
  [WorklistStatus.CANCELLED]: 'Cancelled',
};

const sourceLabels: Record<WorklistSource, string> = {
  [WorklistSource.MANUAL]: 'Manual',
  [WorklistSource.VISIT_FOLLOW_UP]: 'Visit follow-up',
};

const categoryLabels: Record<WorklistCategory, string> = {
  [WorklistCategory.AGENCY]: 'Agency follow-ups',
  [WorklistCategory.WHOLESALE]: 'Wholesale follow-ups',
  [WorklistCategory.GENERAL]: 'General',
};

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toDate = (value: FormDataEntryValue | null | undefined) => {
  const date = toOptional(value);
  return date ? new Date(`${date}T00:00:00`) : null;
};

const toWorklistCategory = (value: FormDataEntryValue | string | null | undefined) => {
  const category = String(value ?? WorklistCategory.GENERAL);
  return Object.values(WorklistCategory).includes(category as WorklistCategory)
    ? (category as WorklistCategory)
    : WorklistCategory.GENERAL;
};

const toWorklistStatus = (value: FormDataEntryValue | string | null | undefined) => {
  const status = String(value ?? WorklistStatus.OPEN);
  return Object.values(WorklistStatus).includes(status as WorklistStatus)
    ? (status as WorklistStatus)
    : WorklistStatus.OPEN;
};

const formatDate = (date: Date | null) => (date ? new Date(date).toLocaleDateString() : '');

async function createWorklistItem(formData: FormData) {
  'use server';

  const currentUser = await requireUser();
  const title = toOptional(formData.get('title'));
  const category = toWorklistCategory(formData.get('category'));
  const assignedToUserId = toOptional(formData.get('assignedToUserId'));

  if (!title) {
    redirect('/alerts?created=invalid');
  }

  const assignedUser = assignedToUserId
    ? await prisma.user.findUnique({ where: { id: assignedToUserId } })
    : null;

  await prisma.worklistItem.create({
    data: {
      title,
      detail: toOptional(formData.get('detail')),
      status: WorklistStatus.OPEN,
      source: WorklistSource.MANUAL,
      category,
      agencyId: category === WorklistCategory.AGENCY ? toOptional(formData.get('agencyId')) : null,
      wholesaleAccountId:
        category === WorklistCategory.WHOLESALE ? toOptional(formData.get('wholesaleAccountId')) : null,
      dueDate: toDate(formData.get('dueDate')),
      assignedTo: assignedUser ? getUserDisplayName(assignedUser) : null,
      assignedToUserId: assignedUser?.id,
      createdBy: getUserDisplayName(currentUser),
      createdByUserId: currentUser.id,
    },
  });

  revalidatePath('/alerts');
  redirect('/alerts?created=1');
}

async function updateWorklistStatus(formData: FormData) {
  'use server';

  const currentUser = await requireUser();
  const id = toOptional(formData.get('id'));
  const status = toWorklistStatus(formData.get('status'));

  if (!id) {
    return;
  }

  await prisma.worklistItem.update({
    where: { id },
    data: {
      status,
      completedAt: status === WorklistStatus.COMPLETED ? new Date() : null,
      cancelledAt: status === WorklistStatus.CANCELLED ? new Date() : null,
      completedByUserId: status === WorklistStatus.COMPLETED ? currentUser.id : null,
      cancelledByUserId: status === WorklistStatus.CANCELLED ? currentUser.id : null,
    },
  });

  revalidatePath('/alerts');
}

export default async function Alerts({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; category?: string; q?: string; created?: string }>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const statusFilter = params.status ?? 'ACTIVE';
  const categoryFilter = params.category ?? 'ALL';
  const where: Prisma.WorklistItemWhereInput = {};

  if (statusFilter === 'ACTIVE') {
    where.status = { notIn: [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED] };
  } else if (statusFilter !== 'ALL') {
    where.status = toWorklistStatus(statusFilter);
  }

  if (categoryFilter !== 'ALL') {
    where.category = toWorklistCategory(categoryFilter);
  }

  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { detail: { contains: q, mode: 'insensitive' } },
      { assignedTo: { contains: q, mode: 'insensitive' } },
      { createdBy: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, agencyOptions, wholesaleOptions, users] = await Promise.all([
    prisma.worklistItem.findMany({
      where,
      take: 300,
      include: {
        assignedToUser: true,
        cancelledByUser: true,
        completedByUser: true,
        createdByUser: true,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.agency.findMany({ orderBy: { name: 'asc' }, take: 500 }),
    prisma.wholesaleAccount.findMany({ orderBy: { name: 'asc' }, take: 500 }),
    prisma.user.findMany({ orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
  ]);

  const agencyMap = Object.fromEntries(agencyOptions.map((agency) => [agency.id, agency.name]));
  const wholesaleMap = Object.fromEntries(wholesaleOptions.map((account) => [account.id, account.name]));

  const groups = Object.values(WorklistCategory).map((category) => ({
    category,
    title: categoryLabels[category],
    items: items.filter((item) => item.category === category),
  }));

  return (
    <>
      <h1>Worklist</h1>
      <p className="muted">
        Follow-ups from visits and manually assigned tasks. Completed and cancelled items are hidden by default.
      </p>

      {params.created === '1' ? <p className="pill">Worklist item created.</p> : null}
      {params.created === 'invalid' ? <p className="pill">A title is required.</p> : null}

      <div className="grid">
        <div className="card">
          <h2>Generate worklist item</h2>
          <form action={createWorklistItem}>
            <label>Title</label>
            <input name="title" placeholder="What needs to happen?" required />

            <label>Category</label>
            <select name="category" defaultValue={WorklistCategory.GENERAL}>
              <option value={WorklistCategory.AGENCY}>Agency follow-up</option>
              <option value={WorklistCategory.WHOLESALE}>Wholesale follow-up</option>
              <option value={WorklistCategory.GENERAL}>General</option>
            </select>

            <label>Agency</label>
            <select name="agencyId">
              <option value="">-- Optional agency --</option>
              {agencyOptions.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name} ({agency.agencyId})
                </option>
              ))}
            </select>

            <label>Wholesale account</label>
            <select name="wholesaleAccountId">
              <option value="">-- Optional wholesale account --</option>
              {wholesaleOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.licenseeId})
                </option>
              ))}
            </select>

            <label>Due date</label>
            <input name="dueDate" type="date" />

            <label>Assigned to</label>
            <select name="assignedToUserId">
              <option value="">-- Unassigned --</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {getUserDisplayName(user)}
                </option>
              ))}
            </select>

            <label>Details</label>
            <textarea name="detail" rows={3} placeholder="Context, instructions, or notes" />

            <button type="submit">Create worklist item</button>
          </form>
        </div>

        <div className="card">
          <h2>Filters</h2>
          <form method="get">
            <label>Status</label>
            <select name="status" defaultValue={statusFilter}>
              <option value="ACTIVE">Active only</option>
              <option value="ALL">All statuses</option>
              {Object.values(WorklistStatus).map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>

            <label>Category</label>
            <select name="category" defaultValue={categoryFilter}>
              <option value="ALL">All categories</option>
              {Object.values(WorklistCategory).map((category) => (
                <option key={category} value={category}>
                  {categoryLabels[category]}
                </option>
              ))}
            </select>

            <label>Search</label>
            <input name="q" defaultValue={q} placeholder="Search title, detail, owner, creator" />

            <button type="submit">Apply filters</button>
          </form>
        </div>
      </div>

      {groups.map((group) => (
        <section className="worklist-section" key={group.category}>
          <div className="section-heading">
            <h2>{group.title}</h2>
            <span className="pill">{group.items.length}</span>
          </div>

          {group.items.length === 0 ? (
            <p className="muted">No matching items.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Source</th>
                  <th>Location</th>
                  <th>Due</th>
                  <th>Assigned</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => {
                  const location =
                    item.category === WorklistCategory.AGENCY
                      ? agencyMap[item.agencyId ?? '']
                      : item.category === WorklistCategory.WHOLESALE
                        ? wholesaleMap[item.wholesaleAccountId ?? '']
                        : '';

                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        {item.detail ? <div className="muted preserve-lines">{item.detail}</div> : null}
                        <div className="muted item-meta">
                          Created by {item.createdByUser ? getUserDisplayName(item.createdByUser) : item.createdBy || 'Unknown user'}
                          {item.completedByUser ? `; completed by ${getUserDisplayName(item.completedByUser)}` : ''}
                          {item.cancelledByUser ? `; cancelled by ${getUserDisplayName(item.cancelledByUser)}` : ''}
                        </div>
                      </td>
                      <td>{sourceLabels[item.source]}</td>
                      <td>{location}</td>
                      <td>{formatDate(item.dueDate)}</td>
                      <td>{item.assignedToUser ? getUserDisplayName(item.assignedToUser) : item.assignedTo}</td>
                      <td>{statusLabels[item.status]}</td>
                      <td>
                        <div className="action-row">
                          {item.status === WorklistStatus.OPEN ? (
                            <form action={updateWorklistStatus}>
                              <input name="id" type="hidden" value={item.id} />
                              <input name="status" type="hidden" value={WorklistStatus.IN_PROGRESS} />
                              <button className="secondary" type="submit">Start</button>
                            </form>
                          ) : null}
                          {item.status !== WorklistStatus.COMPLETED ? (
                            <form action={updateWorklistStatus}>
                              <input name="id" type="hidden" value={item.id} />
                              <input name="status" type="hidden" value={WorklistStatus.COMPLETED} />
                              <button type="submit">Complete</button>
                            </form>
                          ) : null}
                          {item.status !== WorklistStatus.CANCELLED ? (
                            <form action={updateWorklistStatus}>
                              <input name="id" type="hidden" value={item.id} />
                              <input name="status" type="hidden" value={WorklistStatus.CANCELLED} />
                              <button className="secondary" type="submit">Cancel</button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </>
  );
}
