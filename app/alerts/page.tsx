export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { createVisit } from '../visits/actions';
import { WorklistActions } from './WorklistActions';

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

const noticeMessages: Record<string, string> = {
  'visit-logged': 'Visit logged and worklist item completed.',
  'invalid-agency': 'Select an agency before logging an agency visit.',
  'invalid-wholesale': 'Select an existing wholesale account or create one before logging a wholesale visit.',
  'invalid-contact': 'Select a contact tied to the selected account.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
  'photo-upload-failed': 'The visit was saved, but one or more photos could not be uploaded.',
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
  searchParams?: Promise<{ status?: string; category?: string; q?: string; created?: string; notice?: string }>;
}) {
  const currentUser = await requireUser();

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

  const [items, agencyOptions, wholesaleOptions, contacts, users, tags] = await Promise.all([
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
    prisma.agency.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        agencyId: true,
        name: true,
        city: true,
        county: true,
        phone: true,
      },
    }),
    prisma.wholesaleAccount.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        licenseeId: true,
        name: true,
        agencyId: true,
        city: true,
        county: true,
        phone: true,
      },
    }),
    prisma.locationContact.findMany({
      orderBy: { name: 'asc' },
      take: 1000,
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        email: true,
        agencyId: true,
        wholesaleAccountId: true,
      },
    }),
    prisma.user.findMany({ orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    prisma.tag.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
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
      {params.notice ? <p className="pill">{noticeMessages[params.notice] ?? params.notice}</p> : null}

      <div className="worklist-tools">
        <div className="card quick-task-card">
          <h2>Quick task</h2>
          <form action={createWorklistItem} className="quick-task-form">
            <input name="title" placeholder="What needs to happen?" required />
            <input name="dueDate" type="date" aria-label="Due date" />
            <select name="category" defaultValue={WorklistCategory.GENERAL} aria-label="Category">
              <option value={WorklistCategory.AGENCY}>Agency</option>
              <option value={WorklistCategory.WHOLESALE}>Wholesale</option>
              <option value={WorklistCategory.GENERAL}>General</option>
            </select>
            <button type="submit">Create</button>

            <details className="compact-details nested-details quick-task-more">
              <summary>Add account, owner, or details</summary>
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
            </details>
          </form>
        </div>

        <details className="card compact-details filter-panel">
          <summary>Filters</summary>
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
        </details>
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
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Location / Due</th>
                  <th>Owner</th>
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
                      <td data-label="Item">
                        <strong>{item.title}</strong>
                        <div className="inline-meta">
                          <span className="pill">{sourceLabels[item.source]}</span>
                          <span className="pill">{statusLabels[item.status]}</span>
                        </div>
                        {item.detail ? <div className="muted preserve-lines">{item.detail}</div> : null}
                        <div className="muted item-meta">
                          Created by {item.createdByUser ? getUserDisplayName(item.createdByUser) : item.createdBy || 'Unknown user'}
                          {item.completedByUser ? `; completed by ${getUserDisplayName(item.completedByUser)}` : ''}
                          {item.cancelledByUser ? `; cancelled by ${getUserDisplayName(item.cancelledByUser)}` : ''}
                        </div>
                      </td>
                      <td data-label="Location / Due">
                        <strong>{location || 'General'}</strong>
                        <div className="muted">{formatDate(item.dueDate) || 'No due date'}</div>
                      </td>
                      <td data-label="Owner">{item.assignedToUser ? getUserDisplayName(item.assignedToUser) : item.assignedTo}</td>
                      <td data-label="Actions">
                        <WorklistActions
                          actorName={getUserDisplayName(currentUser)}
                          agencies={agencyOptions}
                          contacts={contacts}
                          createVisitAction={createVisit}
                          item={{
                            id: item.id,
                            title: item.title,
                            detail: item.detail,
                            status: item.status,
                            category: item.category,
                            agencyId: item.agencyId,
                            wholesaleAccountId: item.wholesaleAccountId,
                          }}
                          tags={tags}
                          updateStatusAction={updateWorklistStatus}
                          wholesaleAccounts={wholesaleOptions}
                        />
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
