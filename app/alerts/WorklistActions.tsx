'use client';

import { useState } from 'react';
import {
  LogVisitForm,
  type VisitFormAgencyOption,
  type VisitFormContactOption,
  type VisitFormTagOption,
  type VisitFormWholesaleOption,
  type VisitLocationType,
} from '../visits/LogVisitForm';

type WorklistStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type WorklistCategory = 'AGENCY' | 'WHOLESALE' | 'GENERAL';

type WorklistActionItem = {
  id: string;
  title: string;
  detail: string | null;
  editDetail: string | null;
  dueDate: string;
  dueTime: string;
  assignedToUserId: string | null;
  calendarSyncStatus: string | null;
  calendarSyncError: string | null;
  status: WorklistStatus;
  category: WorklistCategory;
  agencyId: string | null;
  wholesaleAccountId: string | null;
  salesOpportunityId: string | null;
  agencyProductIntelligenceId: string | null;
  productItemCode: string | null;
  productName: string | null;
  location: {
    id: string;
    name: string;
    type: VisitLocationType;
  } | null;
};

type WorklistActionsProps = {
  item: WorklistActionItem;
  actorName: string;
  agencies: VisitFormAgencyOption[];
  wholesaleAccounts: VisitFormWholesaleOption[];
  contacts: VisitFormContactOption[];
  tags: VisitFormTagOption[];
  createVisitAction: (formData: FormData) => void | Promise<void>;
  updateStatusAction: (formData: FormData) => void | Promise<void>;
  updateItemAction: (formData: FormData) => void | Promise<void>;
  currentUserId: string;
  users: Array<{ id: string; name: string }>;
};

const getInitialLocationType = (item: WorklistActionItem): VisitLocationType => {
  if (item.location) {
    return item.location.type;
  }

  if (item.category === 'WHOLESALE' || item.wholesaleAccountId) {
    return 'wholesale';
  }

  return 'agency';
};

export function WorklistActions({
  item,
  actorName,
  agencies,
  wholesaleAccounts,
  contacts,
  tags,
  createVisitAction,
  updateStatusAction,
  updateItemAction,
  currentUserId,
  users,
}: WorklistActionsProps) {
  const [openAction, setOpenAction] = useState<'log-visit' | 'reschedule' | 'reassign' | null>(null);
  const initialSummary = [item.title, item.detail].filter(Boolean).join('\n\n');

  return (
    <div className="action-row">
      <button className="secondary" type="button" onClick={() => setOpenAction('log-visit')}>
        Log Visit
      </button>

      <form action={updateStatusAction}>
        <input name="id" type="hidden" value={item.id} />
        <input name="status" type="hidden" value="COMPLETED" />
        <button disabled={item.status === 'COMPLETED'} type="submit">
          Complete
        </button>
      </form>

      <button className="secondary" type="button" onClick={() => setOpenAction('reschedule')}>Reschedule</button>
      <button className="secondary" type="button" onClick={() => setOpenAction('reassign')}>Reassign</button>

      <details className="compact-details worklist-edit-details">
        <summary>More</summary>
        <form action={updateItemAction} className="worklist-edit-form">
          <input name="id" type="hidden" value={item.id} />
          <label>Task<input name="title" defaultValue={item.title} required /></label>
          <label>Details<textarea name="detail" defaultValue={item.editDetail ?? ''} rows={3} /></label>
          <div className="form-grid">
            <label>Due date<input name="dueDate" type="date" defaultValue={item.dueDate} /></label>
            <label>Time <span className="optional-label">Optional</span><input name="dueTime" type="time" defaultValue={item.dueTime} /></label>
            <label>Assigned to<select name="assignedToUserId" defaultValue={item.assignedToUserId ?? ''}><option value="">-- Unassigned --</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          </div>
          {item.calendarSyncStatus ? <p className="field-note">Calendar: {item.calendarSyncStatus.toLowerCase().replaceAll('_', ' ')}{item.calendarSyncError ? ` - ${item.calendarSyncError}` : ''}</p> : null}
          <button type="submit">Save task</button>
        </form>
      </details>

      <form action={updateStatusAction}>
        <input name="id" type="hidden" value={item.id} />
        <input name="status" type="hidden" value="CANCELLED" />
        <button className="secondary" disabled={item.status === 'CANCELLED'} type="submit">
          Cancel
        </button>
      </form>

      {openAction === 'reschedule' ? <div aria-labelledby={`reschedule-${item.id}`} aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
        <button aria-label="Close reschedule" className="app-modal-backdrop" type="button" onClick={() => setOpenAction(null)} />
        <div className="app-modal-panel contextual-action-sheet">
          <div className="app-modal-header"><h2 id={`reschedule-${item.id}`}>Reschedule</h2><button className="app-modal-close secondary" type="button" onClick={() => setOpenAction(null)}>Close</button></div>
          <form action={async (formData) => { await updateItemAction(formData); setOpenAction(null); }} className="contextual-action-form">
            <input name="id" type="hidden" value={item.id} /><input name="title" type="hidden" value={item.title} /><input name="detail" type="hidden" value={item.editDetail ?? ''} /><input name="assignedToUserId" type="hidden" value={item.assignedToUserId ?? ''} />
            <label>Due date<input name="dueDate" type="date" defaultValue={item.dueDate} /></label>
            <label>Time <span className="optional-label">Optional</span><input name="dueTime" type="time" defaultValue={item.dueTime} /></label>
            <button type="submit">Save schedule</button>
          </form>
        </div>
      </div> : null}

      {openAction === 'reassign' ? <div aria-labelledby={`reassign-${item.id}`} aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
        <button aria-label="Close reassign" className="app-modal-backdrop" type="button" onClick={() => setOpenAction(null)} />
        <div className="app-modal-panel contextual-action-sheet">
          <div className="app-modal-header"><h2 id={`reassign-${item.id}`}>Reassign</h2><button className="app-modal-close secondary" type="button" onClick={() => setOpenAction(null)}>Close</button></div>
          <form action={async (formData) => { await updateItemAction(formData); setOpenAction(null); }} className="contextual-action-form">
            <input name="id" type="hidden" value={item.id} /><input name="title" type="hidden" value={item.title} /><input name="detail" type="hidden" value={item.editDetail ?? ''} /><input name="dueDate" type="hidden" value={item.dueDate} /><input name="dueTime" type="hidden" value={item.dueTime} />
            <label>Assigned to<select name="assignedToUserId" defaultValue={item.assignedToUserId ?? ''}><option value="">-- Unassigned --</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <button type="submit">Save assignee</button>
          </form>
        </div>
      </div> : null}

      {openAction === 'log-visit' ? (
        <div aria-labelledby={`log-visit-${item.id}`} aria-modal="true" className="app-modal" role="dialog">
          <button
            aria-label="Close log visit"
            className="app-modal-backdrop"
            type="button"
            onClick={() => setOpenAction(null)}
          />
          <div className="app-modal-panel">
            <div className="app-modal-header">
              <h2 id={`log-visit-${item.id}`}>Log Visit</h2>
              <button className="app-modal-close secondary" type="button" onClick={() => setOpenAction(null)}>
                Close
              </button>
            </div>
            <LogVisitForm
              action={createVisitAction}
              actorName={actorName}
              currentUserId={currentUserId}
              agencies={agencies}
              contacts={contacts}
              formOrigin="worklist"
              initialValues={{
                locationType: getInitialLocationType(item),
                locationName: item.location?.name,
                locationLocked: Boolean(item.location || item.agencyId || item.wholesaleAccountId),
                agencyId: item.location?.type === 'agency' ? item.location.id : item.agencyId,
                wholesaleAccountId:
                  item.location?.type === 'wholesale' ? item.location.id : item.wholesaleAccountId,
                summary: initialSummary,
                opportunityId: item.salesOpportunityId,
                agencyProductIntelligenceId: item.agencyProductIntelligenceId,
                productItemCode: item.productItemCode,
                productName: item.productName,
                sourceLabel: item.title,
                sourceType: 'WORKLIST',
                reason: item.detail,
                returnTo: '/alerts',
              }}
              submitLabel="Log visit"
              tags={tags}
              users={users}
              wholesaleAccounts={wholesaleAccounts}
              worklistItemId={item.id}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
