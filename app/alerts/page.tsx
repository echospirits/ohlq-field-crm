export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../components/SubmitButton';
import { OpportunityEventType, OpportunityStatus, Prisma, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { formatDateOnlyInputValue, formatTimeMinutesInput, formatWorklistDue, parseTimeInputToMinutes } from '../../lib/dateTime';
import { scheduleWorklistSync } from '../../lib/calendar/scheduleWorklistSync';
import { splitReactivationPurchasedAgainDetail } from '../../lib/ohlqWholesaleReactivation';
import { prisma } from '../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../lib/organizations';
import { getAgenciesForVisitPicker, getWholesaleAccountsForVisitPicker } from '../../lib/visitPickerOptions';
import {
  getWorklistCategoryForLocationSelection,
  getWorklistLocationFallbackLabel,
  getWorklistLocations,
} from '../../lib/worklistLocations';
import { AnchoredDetails } from '../components/AnchoredDetails';
import { RecordPicker } from '../components/RecordPicker';
import { DatePickerField } from '../components/DatePickerField';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { WorkViewNavigation } from '../components/WorkViewNavigation';
import { createVisit } from '../visits/actions';
import { WorklistActions } from './WorklistActions';
import { getWorklistGroup, worklistGroups } from '../../lib/worklistPresentation';
import { WorklistDetail } from './WorklistDetail';

export const metadata = buildPageMetadata('Worklist');

const statusLabels: Record<WorklistStatus, string> = {
  [WorklistStatus.OPEN]: 'Open',
  [WorklistStatus.IN_PROGRESS]: 'In progress',
  [WorklistStatus.COMPLETED]: 'Completed',
  [WorklistStatus.CANCELLED]: 'Cancelled',
};

const sourceLabels: Record<WorklistSource, string> = {
  [WorklistSource.AGENCY_INTELLIGENCE]: 'Agency intelligence',
  [WorklistSource.MANUAL]: 'Manual',
  [WorklistSource.OHLQ_WHOLESALE_REACTIVATION]: 'OHLQ wholesale reactivation',
  [WorklistSource.OPPORTUNITY_INTELLIGENCE]: 'Opportunity intelligence',
  [WorklistSource.TARGET_ACCOUNT_INTELLIGENCE]: 'Target account intelligence',
  [WorklistSource.VISIT_FOLLOW_UP]: 'Visit follow-up',
};

const categoryLabels: Record<WorklistCategory, string> = {
  [WorklistCategory.AGENCY]: 'Agency follow-ups',
  [WorklistCategory.WHOLESALE]: 'Wholesale follow-ups',
  [WorklistCategory.GENERAL]: 'General',
};

const noticeMessages: Record<string, string> = {
  'visit-logged': 'Visit logged.',
  'invalid-context': 'The originating task or opportunity no longer matches the selected account.',
  'invalid-agency': 'Select an agency before logging an agency visit.',
  'invalid-wholesale': 'Select an existing wholesale account or create one before logging a wholesale visit.',
  'invalid-contact': 'Select a contact tied to the selected account.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
  'storage-not-configured': 'Photo object storage is not configured yet.',
  'photo-upload-failed': 'The visit was saved, but one or more photos could not be uploaded.',
  'photo-verification-failed': 'The photo could not be verified, so the visit and worklist update were not saved.',
  'invalid-assignee': 'Choose an active team member for the follow-up.',
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

const toWorklistSource = (value: FormDataEntryValue | string | null | undefined) => {
  const source = String(value ?? WorklistSource.MANUAL);
  return Object.values(WorklistSource).includes(source as WorklistSource)
    ? (source as WorklistSource)
    : WorklistSource.MANUAL;
};

async function createWorklistItem(formData: FormData) {
  'use server';

  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const title = toOptional(formData.get('title'));
  const requestedCategory = toWorklistCategory(formData.get('category'));
  const agencyId = toOptional(formData.get('agencyId'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const category = getWorklistCategoryForLocationSelection(
    requestedCategory,
    agencyId,
    wholesaleAccountId,
  );
  const assignedToUserId = toOptional(formData.get('assignedToUserId'));
  const dueDate = toDate(formData.get('dueDate'));

  if (!title) {
    redirect('/alerts?created=invalid');
  }

  const assignedUser = assignedToUserId
    ? await prisma.user.findFirst({ where: { id: assignedToUserId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } } })
    : null;
  if (assignedToUserId && !assignedUser) redirect('/alerts?created=invalid-assignee');

  const item = await prisma.worklistItem.create({
    data: {
      organizationId,
      title,
      detail: toOptional(formData.get('detail')),
      status: WorklistStatus.OPEN,
      source: WorklistSource.MANUAL,
      category,
      agencyId: category === WorklistCategory.AGENCY ? agencyId : null,
      wholesaleAccountId:
        category === WorklistCategory.WHOLESALE ? wholesaleAccountId : null,
      dueDate,
      dueTimeMinutes: dueDate ? parseTimeInputToMinutes(formData.get('dueTime')) : null,
      assignedTo: assignedUser ? getUserDisplayName(assignedUser) : null,
      assignedToUserId: assignedUser?.id,
      createdBy: getUserDisplayName(currentUser),
      createdByUserId: currentUser.id,
    },
  });
  scheduleWorklistSync(item.id);

  revalidatePath('/alerts');
  revalidatePath('/');
  redirect('/alerts?created=1');
}

async function updateWorklistStatus(formData: FormData) {
  'use server';

  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  const status = toWorklistStatus(formData.get('status'));
  if (status !== WorklistStatus.COMPLETED && status !== WorklistStatus.CANCELLED) return { error: 'Choose Complete or Cancel task.' };

  if (!id) return { error: 'This task is missing. Refresh the worklist.' };

  const owned = await prisma.worklistItem.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!owned) return { error: 'This task is no longer available. Refresh the worklist.' };
  await prisma.worklistItem.update({
    where: { id: owned.id },
    data: {
      status,
      completedAt: status === WorklistStatus.COMPLETED ? new Date() : null,
      cancelledAt: status === WorklistStatus.CANCELLED ? new Date() : null,
      completedByUserId: status === WorklistStatus.COMPLETED ? currentUser.id : null,
      cancelledByUserId: status === WorklistStatus.CANCELLED ? currentUser.id : null,
    },
  });
  scheduleWorklistSync(id);
  // Statewide opportunity recalculation belongs to the import/scheduled pipeline.

  revalidatePath('/alerts');
  revalidatePath('/my-week');
  revalidatePath('/');
  return { success: status === WorklistStatus.COMPLETED ? 'Task completed.' : 'Task cancelled.' };
}

async function updateWorklistItem(formData: FormData) {
  'use server';
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  const title = toOptional(formData.get('title'));
  const assignedToUserId = toOptional(formData.get('assignedToUserId'));
  const dueDate = toDate(formData.get('dueDate'));
  if (!id || !title) return { error: 'Enter a task title before saving.' };
  const assignedUser = assignedToUserId
    ? await prisma.user.findFirst({ where: { id: assignedToUserId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } } })
    : null;
  if (assignedToUserId && !assignedUser) return { error: 'Choose an active team member or Unassigned.' };
  const previous = await prisma.worklistItem.findFirst({ where: { id, organizationId }, select: { assignedToUserId: true, salesOpportunityId: true, wholesaleAccountId: true } });
  if (!previous) return { error: 'This task is no longer available. Refresh the worklist.' };
  await prisma.worklistItem.update({
    where: { id },
    data: {
      title,
      detail: toOptional(formData.get('detail')),
      dueDate,
      dueTimeMinutes: dueDate ? parseTimeInputToMinutes(formData.get('dueTime')) : null,
      assignedToUserId: assignedUser?.id ?? null,
      assignedTo: assignedUser ? getUserDisplayName(assignedUser) : null,
    },
  });
  if (previous.salesOpportunityId && previous.wholesaleAccountId && previous.assignedToUserId !== (assignedUser?.id ?? null)) {
    await prisma.opportunityEvent.create({ data: { organizationId, opportunityId: previous.salesOpportunityId, eventType: OpportunityEventType.TASK_REASSIGNED, eventKey: `TASK_REASSIGNED:${id}:${assignedUser?.id ?? 'unassigned'}:${Date.now()}`, wholesaleAccountId: previous.wholesaleAccountId, userId: currentUser.id, worklistItemId: id, metadata: { assignedToUserId: assignedUser?.id ?? null }, occurredAt: new Date() } });
  }
  scheduleWorklistSync(id);
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  revalidatePath('/');
  return { success: 'Task saved.' };
}

export default async function Alerts({
  searchParams,
}: {
  searchParams?: Promise<{
    category?: string;
    created?: string;
    notice?: string;
    q?: string;
    source?: string;
    status?: string;
    view?: string;
    owner?: string;
  }>;
}) {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const excludedIntelligenceSources: WorklistSource[] = [
    ...(!enabledFeatures.has('AGENCY_INTELLIGENCE') ? [WorklistSource.AGENCY_INTELLIGENCE] : []),
    ...(!enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? [WorklistSource.OPPORTUNITY_INTELLIGENCE] : []),
  ];
  const visibleSources = Object.values(WorklistSource).filter((source) => !excludedIntelligenceSources.includes(source));

  const params = (await searchParams) ?? {};
  const q = (params.q ?? '').trim();
  const statusFilter = params.status ?? 'ACTIVE';
  const categoryFilter = params.category ?? 'ALL';
  const sourceFilter = params.source ?? 'ALL';
  const pursuingView = params.view === 'pursuing';
  const where: Prisma.WorklistItemWhereInput = { organizationId, ...(excludedIntelligenceSources.length ? { source: { notIn: excludedIntelligenceSources } } : {}) };

  if (params.owner === 'mine') where.assignedToUserId = currentUser.id;
  if (params.owner === 'unassigned') where.assignedToUserId = null;

  if (statusFilter === 'ACTIVE') {
    where.status = { notIn: [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED] };
  } else if (statusFilter !== 'ALL') {
    where.status = toWorklistStatus(statusFilter);
  }

  if (categoryFilter !== 'ALL') {
    where.category = toWorklistCategory(categoryFilter);
  }

  if (sourceFilter !== 'ALL') {
    const requestedSource = toWorklistSource(sourceFilter);
    if (!excludedIntelligenceSources.includes(requestedSource)) where.source = requestedSource;
  }

  if (pursuingView && enabledFeatures.has('WHOLESALE_OPPORTUNITIES')) {
    where.salesOpportunity = { status: OpportunityStatus.ACTIONED };
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
        calendarEvents: { where: { provider: 'GOOGLE' } },
        loggedVisit: {
          select: {
            locationType: true,
            agencyId: true,
            wholesaleAccountId: true,
          },
        },
        agencyProductIntelligence: { select: { itemCode: true, itemName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    getAgenciesForVisitPicker({ organizationId }),
    getWholesaleAccountsForVisitPicker({ organizationId }),
    prisma.locationContact.findMany({
      where: { organizationId, active: true },
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
        active: true,
        isPrimary: true,
      },
    }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    prisma.tag.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
  ]);

  const worklistLocations = await getWorklistLocations(items);

  const groups = worklistGroups.map((title) => ({
    title,
    items: items.filter((item) => getWorklistGroup(item) === title),
  })).filter((group) => group.items.length > 0);
  const ownerHref = (owner: string) => {
    const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    query.set('owner', owner);
    return '/alerts?' + query.toString();
  };

  return (
    <>
      <header className="page-heading page-header">
        <div>
          <span className="page-eyebrow">My work</span>
          <h1>Worklist</h1>
          <p className="muted">
            Your follow-ups, organized by what needs attention first.
          </p>
        </div>
        <a className="btn secondary" href="#quick-task">Add task</a>
      </header>
      <WorkViewNavigation active={pursuingView ? 'pursuing' : 'all'} showPursuing={enabledFeatures.has('WHOLESALE_OPPORTUNITIES')} />

      {params.created === '1' ? <p className="pill">Worklist item created.</p> : null}
      {params.created === 'invalid-assignee' ? <p className="notice danger" role="alert">Choose an active team member for the task.</p> : null}
      {params.created === 'invalid' ? <p className="pill">A title is required.</p> : null}
      {params.notice ? <p className="pill">{noticeMessages[params.notice] ?? params.notice}</p> : null}

      <nav className="scope-tabs" aria-label="Task owner">
        <Link aria-current={!params.owner || params.owner === 'all' ? 'page' : undefined} href={ownerHref('all')}>Team work</Link>
        <Link aria-current={params.owner === 'mine' ? 'page' : undefined} href={ownerHref('mine')}>My work</Link>
        <Link aria-current={params.owner === 'unassigned' ? 'page' : undefined} href={ownerHref('unassigned')}>Unassigned</Link>
      </nav>
      {items.length === 300 ? <p className="field-note">Showing the first 300 matches. Narrow the filters to find more specific work.</p> : null}
      {items.length === 0 ? <p className="empty-state">No tasks match this view. Adjust the filters or add a task below.</p> : null}
      <div className="worklist-layout">
        <details className="card compact-details filter-panel">
          <summary>Filters · status, category, source, search</summary>
          <LiveFilterForm label="Filter worklist items">
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

            <label>Source</label>
            <select name="source" defaultValue={sourceFilter}>
              <option value="ALL">All sources</option>
              {visibleSources.map((source) => (
                <option key={source} value={source}>
                  {sourceLabels[source]}
                </option>
              ))}
            </select>

            <label>Search</label>
            <input name="q" defaultValue={q} placeholder="Search title, detail, owner, creator" />
          </LiveFilterForm>
        </details>

        {groups.map((group) => (
          <section className="worklist-section" key={group.title}>
          <div className="section-heading">
            <h2>{group.title}</h2>
            <span className="pill">{group.items.length}</span>
          </div>

          {group.items.length === 0 ? (
            <p className="muted">No matching items.</p>
          ) : (
            <table className="responsive-table worklist-table">
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
                  const parsedDetail = splitReactivationPurchasedAgainDetail(item.detail);
                  const location = worklistLocations.get(item.id);

                  return (
                    <tr id={`worklist-${item.id}`} key={item.id}>
                      <td data-label="Item">
                        <strong>{item.title}</strong>
                        <details className="task-context"><summary>Task details</summary><div className="inline-meta">
                          <span className="pill">{categoryLabels[item.category]}</span><span className="pill">{sourceLabels[item.source]}</span>
                          <span className="pill">{statusLabels[item.status]}</span>
                        </div>
                        <WorklistDetail detail={item.detail} />
                        <div className="muted item-meta">
                          Created by {item.createdByUser ? getUserDisplayName(item.createdByUser) : item.createdBy || 'Unknown user'}
                          {item.completedByUser ? `; completed by ${getUserDisplayName(item.completedByUser)}` : ''}
                          {item.cancelledByUser ? `; cancelled by ${getUserDisplayName(item.cancelledByUser)}` : ''}
                        </div>
                        </details>
                      </td>
                      <td data-label="Location / Due">
                        {location ? (
                          <Link className="table-link" href={location.href}>
                            {location.name}
                          </Link>
                        ) : (
                          <strong>{getWorklistLocationFallbackLabel(item)}</strong>
                        )}
                        <div className="muted">{formatWorklistDue(item.dueDate, item.dueTimeMinutes) || 'No due date'}</div>
                      </td>
                      <td data-label="Owner">{item.assignedToUser ? getUserDisplayName(item.assignedToUser) : item.assignedTo || 'Unassigned'}</td>
                      <td data-label="Actions">
                        <WorklistActions
                          actorName={getUserDisplayName(currentUser)}
                          currentUserId={currentUser.id}
                          agencies={agencyOptions}
                          contacts={contacts}
                          createVisitAction={createVisit}
                          item={{
                            id: item.id,
                            title: item.title,
                            detail: parsedDetail.detail,
                            editDetail: item.detail,
                            dueDate: formatDateOnlyInputValue(item.dueDate ?? undefined),
                            dueTime: formatTimeMinutesInput(item.dueTimeMinutes),
                            assignedToUserId: item.assignedToUserId,
                            calendarSyncStatus: item.calendarEvents[0]?.syncStatus ?? null,
                            calendarSyncError: item.calendarEvents[0]?.syncError ?? null,
                            status: item.status,
                            category: item.category,
                            agencyId: item.agencyId,
                            wholesaleAccountId: item.wholesaleAccountId,
                            salesOpportunityId: item.salesOpportunityId,
                            agencyProductIntelligenceId: item.agencyProductIntelligenceId,
                            productItemCode: item.agencyProductIntelligence?.itemCode ?? null,
                            productName: item.agencyProductIntelligence?.itemName ?? null,
                            location: location
                              ? { id: location.id, name: location.name, type: location.type }
                              : null,
                          }}
                          tags={tags}
                          users={users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }))}
                          updateItemAction={updateWorklistItem}
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

        <AnchoredDetails className="card quick-task-card" id="quick-task" summary="Add a task" initialOpen={params.created === 'invalid'}>
          <form action={createWorklistItem} className="quick-task-form">
            <label>Task<input name="title" placeholder="What needs to happen?" required /></label>
            <DatePickerField name="dueDate" aria-label="Due date" pickerLabel="Choose due date" />
            <input aria-label="Due time (optional)" name="dueTime" type="time" />
            <select name="category" defaultValue={WorklistCategory.GENERAL} aria-label="Category">
              <option value={WorklistCategory.AGENCY}>Agency</option>
              <option value={WorklistCategory.WHOLESALE}>Wholesale</option>
              <option value={WorklistCategory.GENERAL}>General</option>
            </select>
            <SubmitButton type="submit">Create task</SubmitButton>

            <details className="compact-details nested-details quick-task-more">
              <summary>Add account, owner, or details</summary>
              <RecordPicker label="Agency" name="agencyId" options={agencyOptions.map((agency) => ({ value: agency.id, label: agency.name + ' (' + agency.agencyId + ')' }))} />
              <RecordPicker label="Wholesale account" name="wholesaleAccountId" options={wholesaleOptions.map((account) => ({ value: account.id, label: account.name + ' (' + account.licenseeId + ')' }))} />

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
        </AnchoredDetails>
      </div>
    </>
  );
}
