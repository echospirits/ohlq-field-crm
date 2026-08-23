'use client';

import { useEffect, useState, useTransition } from 'react';
import type { CRMActionContext } from '../../lib/crmActionContext';
import { getContextualVisitHref, getDirectionsHref, getSuggestedFollowUpTitle } from '../../lib/crmActionContext';
import { createContextualFollowUp } from '../contextual-actions/actions';

type ActionUser = { id: string; name: string };

export function ContextualActions({
  context,
  currentUserId,
  users,
  phone,
  email,
  address,
  followUpLabel = 'Create Follow-up',
  hasExistingFollowUp = false,
  showFollowUp = true,
  showLogVisit = true,
}: {
  context: CRMActionContext;
  currentUserId: string;
  users: ActionUser[];
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  followUpLabel?: string;
  hasExistingFollowUp?: boolean;
  showFollowUp?: boolean;
  showLogVisit?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState('');
  const directionsHref = getDirectionsHref(address);

  useEffect(() => {
    if (!isOpen) return;
    setSubmissionKey(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setIsOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [isOpen]);

  const submit = (formData: FormData) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await createContextualFollowUp(formData);
      setFeedback(result.message);
      if (result.ok) {
        window.setTimeout(() => setIsOpen(false), 650);
      }
    });
  };

  return <div className="contextual-actions">
    {showFollowUp ? (
      <button className="compact-btn" disabled={hasExistingFollowUp} type="button" onClick={() => setIsOpen(true)}>
        {hasExistingFollowUp ? 'On worklist' : followUpLabel}
      </button>
    ) : null}
    {showLogVisit ? <a className="btn secondary compact-btn" href={getContextualVisitHref(context)}>Log Visit</a> : null}
    {phone || email || directionsHref ? <details className="contextual-overflow">
      <summary aria-label="More account actions">More</summary>
      <div className="contextual-overflow-menu">
        {phone ? <a href={`tel:${phone}`}>Call</a> : null}
        {phone ? <a href={`sms:${phone}`}>Text</a> : null}
        {email ? <a href={`mailto:${email}`}>Email</a> : null}
        {directionsHref ? <a href={directionsHref} rel="noreferrer" target="_blank">Directions</a> : null}
      </div>
    </details> : null}

    {isOpen ? <div aria-labelledby="create-follow-up-title" aria-modal="true" className="app-modal contextual-action-modal" role="dialog">
      <button aria-label="Close create follow-up" className="app-modal-backdrop" type="button" onClick={() => setIsOpen(false)} />
      <div className="app-modal-panel contextual-action-sheet">
        <div className="app-modal-header">
          <div><span className="page-eyebrow">In context</span><h2 id="create-follow-up-title">Create Follow-up</h2></div>
          <button className="app-modal-close secondary" type="button" onClick={() => setIsOpen(false)}>Close</button>
        </div>
        <form action={submit} className="contextual-action-form">
          {Object.entries(context).map(([key, value]) => value ? <input key={key} name={key} type="hidden" value={value} /> : null)}
          <input name="submissionKey" type="hidden" value={submissionKey} />
          <div className="action-context-summary">
            <strong>{context.accountName ?? 'Selected account'}</strong>
            {context.productItemCode || context.productName ? <span>{[context.productItemCode, context.productName].filter(Boolean).join(' - ')}</span> : null}
            {context.reason ? <small>{context.reason}</small> : null}
          </div>
          <label>Title<input autoFocus defaultValue={getSuggestedFollowUpTitle(context)} name="title" required /></label>
          <div className="form-grid">
            <label>Due date <span className="optional-label">Optional</span><input name="dueDate" type="date" /></label>
            <label>Time <span className="optional-label">Optional</span><input name="dueTime" type="time" /></label>
          </div>
          <label>Assigned to<select defaultValue={currentUserId} name="assignedToUserId" required>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label>Note <span className="optional-label">Optional</span><textarea name="note" rows={3} /></label>
          {feedback ? <p aria-live="polite" className="toast-notice contextual-feedback">{feedback}</p> : null}
          <button disabled={isPending || !submissionKey} type="submit">{isPending ? 'Creating…' : 'Create Follow-up'}</button>
        </form>
      </div>
    </div> : null}
  </div>;
}
