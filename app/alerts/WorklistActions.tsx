'use client';

import { SubmitButton } from '../components/SubmitButton';
import { useCallback, useRef, useState } from 'react';
import { ActionForm, type ActionResult } from '../components/ActionForm';
import { useDialogFocus } from '../components/useDialogFocus';
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
  updateStatusAction: (formData: FormData) => Promise<ActionResult>;
  updateItemAction: (formData: FormData) => Promise<ActionResult>;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeDialog = useCallback(() => setOpenAction(null), []);
  useDialogFocus(dialogRef, openAction !== null, closeDialog);
  const initialSummary = [item.title, item.detail].filter(Boolean).join('\n\n');

  return (
    <div className="action-row task-actions">
      <button className="secondary" type="button" onClick={() => setOpenAction('log-visit')}>
        Log Visit
      </button>

      <ActionForm action={updateStatusAction}>
        <input name="id" type="hidden" value={item.id} />
        <input name="status" type="hidden" value="COMPLETED" />
        <SubmitButton disabled={item.status === 'COMPLETED'} pendingLabel="Completing…" type="submit">
          {item.status === 'COMPLETED' ? 'Completed' : 'Complete'}
        </SubmitButton>
      </ActionForm>

      <button className="secondary" type="button" onClick={() => setOpenAction('reschedule')}>Reschedule</button>


      <details className="compact-details worklist-edit-details">
        <summary>Edit, reassign, or cancel</summary>
      <button className="secondary" type="button" onClick={() => setOpenAction('reassign')}>Reassign</button>
        <ActionForm action={updateItemAction} className="worklist-edit-form">
          <input name="id" type="hidden" value={item.id} />
          <label>Task<input name="title" defaultValue={item.title} required /></label>
          <label>Details<textarea name="detail" defaultValue={item.editDetail ?? ''} rows={3} /></label>
          <div className="form-grid">
            <label>Due date<input name="dueDate" type="date" defaultValue={item.dueDate} /></label>
            <label>Time <span className="optional-label">Optional</span><input name="dueTime" type="time" defaultValue={item.dueTime} /></label>
            <label>Assigned to<select name="assignedToUserId" defaultValue={item.assignedToUserId ?? ''}><option value="">-- Unassigned --</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          </div>
          {item.calendarSyncStatus ? <p className="field-note">Calendar: {item.calendarSyncStatus.toLowerCase().replaceAll('_', ' ')}{item.calendarSyncError ? ` - ${item.calendarSyncError}` : ''}</p> : null}
          <SubmitButton type="submit">Save task</SubmitButton>
        </ActionForm>
      <ActionForm action={updateStatusAction}>
        <input name="id" type="hidden" value={item.id} />
        <input name="status" type="hidden" value="CANCELLED" />
        <SubmitButton className="secondary" disabled={item.status === 'CANCELLED'} pendingLabel="Cancelling…" type="submit">
          {item.status === 'CANCELLED' ? 'Cancelled' : 'Cancel task'}
        </SubmitButton>
      </ActionForm>
      </details>



      {openAction === 'reschedule' ? <div aria-labelledby={`reschedule-${item.id}`} aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
        <button aria-label="Close reschedule" className="app-modal-backdrop" type="button" onClick={() => setOpenAction(null)} />
        <div ref={dialogRef} className="app-modal-panel contextual-action-sheet">
          <div className="app-modal-header"><h2 id={`reschedule-${item.id}`}>Reschedule</h2><button className="app-modal-close secondary" type="button" onClick={() => setOpenAction(null)}>Close</button></div>
          <ActionForm action={updateItemAction} onSuccess={closeDialog} className="contextual-action-form">
            <input name="id" type="hidden" value={item.id} /><input name="title" type="hidden" value={item.title} /><input name="detail" type="hidden" value={item.editDetail ?? ''} /><input name="assignedToUserId" type="hidden" value={item.assignedToUserId ?? ''} />
            <label>Due date<input name="dueDate" type="date" defaultValue={item.dueDate} /></label>
            <label>Time <span className="optional-label">Optional</span><input name="dueTime" type="time" defaultValue={item.dueTime} /></label>
            <SubmitButton type="submit">Save schedule</SubmitButton>
          </ActionForm>
        </div>
      </div> : null}

      {openAction === 'reassign' ? <div aria-labelledby={`reassign-${item.id}`} aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
        <button aria-label="Close reassign" className="app-modal-backdrop" type="button" onClick={() => setOpenAction(null)} />
        <div ref={dialogRef} className="app-modal-panel contextual-action-sheet">
          <div className="app-modal-header"><h2 id={`reassign-${item.id}`}>Reassign</h2><button className="app-modal-close secondary" type="button" onClick={() => setOpenAction(null)}>Close</button></div>
          <ActionForm action={updateItemAction} onSuccess={closeDialog} className="contextual-action-form">
            <input name="id" type="hidden" value={item.id} /><input name="title" type="hidden" value={item.title} /><input name="detail" type="hidden" value={item.editDetail ?? ''} /><input name="dueDate" type="hidden" value={item.dueDate} /><input name="dueTime" type="hidden" value={item.dueTime} />
            <label>Assigned to<select name="assignedToUserId" defaultValue={item.assignedToUserId ?? ''}><option value="">-- Unassigned --</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <SubmitButton type="submit">Save assignee</SubmitButton>
          </ActionForm>
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
          <div ref={dialogRef} className="app-modal-panel">
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
