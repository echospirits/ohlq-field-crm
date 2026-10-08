import { getAccountWorklist } from '../../lib/accountWorklist';
import { getUserDisplayName } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { formatDateOnlyInputValue, formatTimeMinutesInput, formatWorklistDue } from '../../lib/dateTime';
import { getWorklistGroup, worklistGroups } from '../../lib/worklistPresentation';
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
    ]);
  } catch (error) {
    console.error('Account outstanding work unavailable', error);
    return <section className="card account-workspace-section account-worklist" id="account-worklist"><h2>Outstanding work</h2><p className="notice danger" role="alert">Unable to load outstanding work.</p><form action={returnTo} method="get"><button className="secondary" type="submit">Retry</button></form></section>;
  }
  const [items, contacts, users, tags] = data;
  const actionUsers = users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }));
  return (
    <section className="card account-workspace-section account-worklist" id="account-worklist" aria-labelledby="account-worklist-heading">
      <div className="section-heading"><h2 id="account-worklist-heading">Outstanding work</h2><span className="pill">{items.length}</span></div>
      {items.length === 0 ? <p className="muted">No outstanding work for this account. Use Create follow-up in the account actions to add a task.</p> : <>
        <p className="field-note">Team tasks for this account, including unassigned work.</p>
        {worklistGroups.filter((group) => group !== 'Finished').map((group) => {
          const grouped = items.filter((item) => getWorklistGroup(item) === group);
          return grouped.length ? <div className="account-worklist-group" key={group}>
            <h3>{group}</h3>
            {grouped.map((item) => <article className="account-worklist-item" key={item.id} aria-label={item.title}>
              <strong className="account-worklist-title">{item.title}</strong>
              <div className="inline-meta"><span>{item.status === 'IN_PROGRESS' ? 'In progress' : 'Open'}</span><span>{formatWorklistDue(item.dueDate, item.dueTimeMinutes) || 'No due date'}</span><span>Owner: {item.assignedToUser ? getUserDisplayName(item.assignedToUser) : item.assignedTo || 'Unassigned'}</span></div>
              {item.detail ? <details className="task-context"><summary>Task details</summary><WorklistDetail detail={item.detail} /></details> : null}
              <WorklistActions actorName={props.actorName} currentUserId={props.currentUserId} agencies={[]} wholesaleAccounts={[]} contacts={contacts} tags={tags} users={actionUsers} returnTo={returnTo}
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
    </section>
  );
}
