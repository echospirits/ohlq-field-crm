import { AccountPlaybooks } from '../account-memory/AccountPlaybooks';
import { playbookStep } from '../../lib/crm/playbooks';
import { z } from 'zod';
import { getAccountWorklist } from '../../lib/accountWorklist';
import { getUserDisplayName } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { formatDateOnlyInputValue, formatTimeMinutesInput, formatWorklistDue } from '../../lib/dateTime';
import { getWorklistGroup, getWorklistOverdueLabel, worklistGroups } from '../../lib/worklistPresentation';
import { splitReactivationPurchasedAgainDetail } from '../../lib/ohlqWholesaleReactivation';
import { WorklistActions } from '../alerts/WorklistActions';
import { WorklistDetail } from '../alerts/WorklistDetail';
import { updateWorklistItem, updateWorklistStatus } from '../alerts/actions';
import { createVisit } from '../visits/actions';

export async function AccountWorklist(props: {
  organizationId: string;
  accountId: string;
  accountName: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  currentUserId: string;
  actorName: string;
  enabledFeatures: ReadonlySet<string>;
}) {
  const { accountId, accountType, organizationId } = props;
  const type = accountType === 'AGENCY' ? 'agency' : 'wholesale';
  const returnTo = `${type === 'agency' ? '/agencies' : '/wholesale'}/${accountId}#account-worklist`;
  let data;
  try {
    data = await Promise.all([
      getAccountWorklist(props),
      prisma.locationContact.findMany({ where: { organizationId, active: true, ...(type === 'agency' ? { agencyId: accountId } : { wholesaleAccountId: accountId }) }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] }),
      prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, select: { id: true, name: true, email: true }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
      prisma.tag.findMany({ where: { organizationId }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
      prisma.salesPlaybook.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' } }),
      prisma.playbookRun.findMany({ where: { organizationId, accountType, accountId, status: 'ACTIVE' }, include: { tasks: { select: { status: true } } }, orderBy: { startedAt: 'desc' }, take: 30 }),
    ]);
  } catch (error) {
    console.error('Account outstanding work unavailable', error);
    return <section className="card account-workspace-section account-worklist" id="account-worklist"><h2>Outstanding work</h2><p className="notice danger" role="alert">Unable to load outstanding work.</p><form action={returnTo} method="get"><button className="secondary" type="submit">Retry</button></form></section>;
  }
  const [items, contacts, users, tags, templates, runs] = data;
  const actionUsers = users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }));
  return (
    <section className="card account-workspace-section account-worklist" id="account-worklist" aria-labelledby="account-worklist-heading">
      <div className="section-heading"><h2 id="account-worklist-heading">Outstanding work</h2><span className="pill">{items.length}</span></div>
      {items.length === 0 ? <p className="muted">No outstanding work. Use More actions to create a follow-up.</p> : <>
        <p className="field-note">Team tasks for this account, including unassigned work.</p>
        {worklistGroups.filter((group) => group !== 'Finished').map((group) => {
          const grouped = items.filter((item) => getWorklistGroup(item) === group);
          return grouped.length ? <div className="account-worklist-group" key={group}>
            <h3>{group}</h3>
            {grouped.map((item) => <article className="account-worklist-item" key={item.id} aria-label={item.title}>
              <strong className="account-worklist-title">{item.title}</strong>
              <div className="inline-meta">{item.status === 'IN_PROGRESS' ? <span>In progress</span> : null}{getWorklistOverdueLabel(item.dueDate, item.status) ? <strong className="worklist-overdue-label">{getWorklistOverdueLabel(item.dueDate, item.status)}</strong> : null}<span>{formatWorklistDue(item.dueDate, item.dueTimeMinutes) || 'No due date'}</span><span>{item.assignedToUser ? getUserDisplayName(item.assignedToUser) : item.assignedTo || 'Unassigned'}</span></div>
              <WorklistActions actorName={props.actorName} currentUserId={props.currentUserId} agencies={[]} wholesaleAccounts={[]} contacts={contacts} tags={tags} users={actionUsers} returnTo={returnTo}
                evidence={item.detail ? <WorklistDetail detail={item.detail} /> : undefined}
                createVisitAction={createVisit} updateItemAction={updateWorklistItem} updateStatusAction={updateWorklistStatus}
                item={{ id: item.id, title: item.title, detail: splitReactivationPurchasedAgainDetail(item.detail).detail, editDetail: item.detail,
                  dueDate: formatDateOnlyInputValue(item.dueDate), dueTime: formatTimeMinutesInput(item.dueTimeMinutes), assignedToUserId: item.assignedToUserId,
                  calendarSyncStatus: item.calendarEvents[0]?.syncStatus ?? null, calendarSyncError: item.calendarEvents[0]?.syncError ?? null,
                  status: item.status, category: item.category, agencyId: item.agencyId, wholesaleAccountId: item.wholesaleAccountId,
                  salesOpportunityId: item.salesOpportunityId, agencyProductIntelligenceId: item.agencyProductIntelligenceId,
                  productItemCode: item.agencyProductIntelligence?.itemCode ?? null, productName: item.agencyProductIntelligence?.itemName ?? null,
                  location: { id: accountId, name: props.accountName, type },
                }} />
            </article>)}
          </div> : null;
        })}
      </>}
      <AccountPlaybooks accountId={accountId} accountType={accountType} currentUserId={props.currentUserId} users={actionUsers} templates={templates.map(t => ({ id:t.id, name:t.name, steps:z.array(playbookStep).parse(t.steps) }))} runs={runs.map(r => ({id:r.id,name:String((r.snapshot as {name?:string}).name ?? 'Playbook'),open:r.tasks.filter(t=>t.status==='OPEN'||t.status==='IN_PROGRESS').length,complete:r.tasks.filter(t=>t.status==='COMPLETED').length,total:r.tasks.length}))}/>
    </section>
  );
}
