'use client';

import { useCallback, useRef, useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { useDialogFocus } from '../../components/useDialogFocus';
import type { VisitRelatedWorkItem, VisitRelatedWorkResult } from '../../../lib/visitRelatedWork';
import styles from './RelatedWorkPrompt.module.css';

export function RelatedWorkPrompt({ visitId, initialItems, completeAction }: {
  visitId: string;
  initialItems: VisitRelatedWorkItem[];
  completeAction: (data: FormData) => Promise<VisitRelatedWorkResult>;
}) {
  const [items, setItems] = useState(initialItems);
  const [open, setOpen] = useState(initialItems.length > 0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(dialogRef, open, close);

  const complete = async (ids: string[], pendingId: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(pendingId);
    setError('');
    try {
      const data = new FormData();
      data.set('visitId', visitId);
      ids.forEach((id) => data.append('worklistItemId', id));
      const result = await completeAction(data);
      const completed = new Set(result.completedIds);
      setItems((current) => current.filter((item) => !completed.has(item.id)));
      if (result.error) setError(result.error);
      else if (completed.size) window.dispatchEvent(new CustomEvent('neat-action-success', { detail: completed.size === 1 ? 'Task completed.' : 'Related work completed.' }));
      if (!result.error && ids.length === items.length) setOpen(false);
    } catch (cause) {
      unstable_rethrow(cause);
      setError('Could not confirm completion. Check the Worklist before retrying.');
    } finally {
      submitting.current = false;
      setPending(null);
    }
  };

  if (!open || !items.length) return null;
  return <div aria-labelledby="related-work-title" aria-modal="true" className={`app-modal ${styles.modal}`} role="dialog">
    <button aria-label="Leave related work open" className="app-modal-backdrop" type="button" onClick={close} />
    <div className={`app-modal-panel contextual-action-sheet ${styles.panel}`} ref={dialogRef}>
      <div className="app-modal-header"><h2 id="related-work-title">Complete related work?</h2><button className="secondary app-modal-close" type="button" onClick={close}>Close</button></div>
      <ul aria-label="Open related work" className={styles.list}>
        {items.map((item) => <li className={styles.item} key={item.id}>
          <div className={styles.context}><strong>{item.title}</strong>
            <span className={styles.meta}>{item.dueDate ? `Due ${item.dueDate}` : 'No due date'} · {item.assignedTo ?? 'Unassigned'}</span>
            {item.detail ? <p>{item.detail}</p> : null}
          </div>
          <button className="secondary" disabled={pending !== null} type="button" onClick={() => void complete([item.id], item.id)}>{pending === item.id ? 'Completing…' : 'Complete'}</button>
        </li>)}
      </ul>
      {error ? <p className="notice danger" role="alert">{error}</p> : null}
      <div className={styles.actions}><button disabled={pending !== null} type="button" onClick={() => void complete(items.map((item) => item.id), 'all')}>{pending === 'all' ? 'Completing…' : `Complete all (${items.length})`}</button><button className="secondary" type="button" onClick={close}>Leave open</button></div>
    </div>
  </div>;
}
