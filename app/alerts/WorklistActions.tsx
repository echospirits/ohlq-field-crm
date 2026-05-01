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
  status: WorklistStatus;
  category: WorklistCategory;
  agencyId: string | null;
  wholesaleAccountId: string | null;
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
};

const getInitialLocationType = (item: WorklistActionItem): VisitLocationType => {
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
}: WorklistActionsProps) {
  const [isLogVisitOpen, setIsLogVisitOpen] = useState(false);
  const initialSummary = [item.title, item.detail].filter(Boolean).join('\n\n');

  return (
    <div className="action-row">
      <button className="secondary" type="button" onClick={() => setIsLogVisitOpen(true)}>
        Log Visit
      </button>

      <form action={updateStatusAction}>
        <input name="id" type="hidden" value={item.id} />
        <input name="status" type="hidden" value="COMPLETED" />
        <button disabled={item.status === 'COMPLETED'} type="submit">
          Complete
        </button>
      </form>

      <form action={updateStatusAction}>
        <input name="id" type="hidden" value={item.id} />
        <input name="status" type="hidden" value="CANCELLED" />
        <button className="secondary" disabled={item.status === 'CANCELLED'} type="submit">
          Cancel
        </button>
      </form>

      {isLogVisitOpen ? (
        <div aria-labelledby={`log-visit-${item.id}`} aria-modal="true" className="app-modal" role="dialog">
          <button
            aria-label="Close log visit"
            className="app-modal-backdrop"
            type="button"
            onClick={() => setIsLogVisitOpen(false)}
          />
          <div className="app-modal-panel">
            <div className="app-modal-header">
              <h2 id={`log-visit-${item.id}`}>Log Visit</h2>
              <button className="app-modal-close secondary" type="button" onClick={() => setIsLogVisitOpen(false)}>
                Close
              </button>
            </div>
            <LogVisitForm
              action={createVisitAction}
              actorName={actorName}
              agencies={agencies}
              contacts={contacts}
              formOrigin="worklist"
              initialValues={{
                locationType: getInitialLocationType(item),
                agencyId: item.agencyId,
                wholesaleAccountId: item.wholesaleAccountId,
                summary: initialSummary,
              }}
              submitLabel="Log visit and complete item"
              tags={tags}
              wholesaleAccounts={wholesaleAccounts}
              worklistItemId={item.id}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
