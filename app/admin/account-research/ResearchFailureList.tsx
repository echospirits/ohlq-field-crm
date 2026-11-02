'use client';

import Link from 'next/link';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { ActionForm, ActionPendingContext } from '../../components/ActionForm';
import { SubmitButton } from '../../components/SubmitButton';
import { WholesaleAccountEditFields, type WholesaleAccountEditValues } from '../../components/WholesaleAccountEditFields';
import { loadResearchAccountEditor, saveResearchAccount } from './edit-account-actions';

export type ResearchFailure = {
  id: string;
  accountId: string;
  name: string;
  identity: string;
  reason: string;
  submittedLocation: string;
  failedAt: string;
};

function EditorActions({ onCancel }: { onCancel: () => void }) {
  const pending = useContext(ActionPendingContext);
  return <div className="research-edit-actions">
    <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    <button className="secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button>
  </div>;
}

function EditorFields({ account }: { account: WholesaleAccountEditValues }) {
  const pending = useContext(ActionPendingContext);
  return <fieldset className="research-edit-fields" disabled={pending} aria-label="Account details">
    <WholesaleAccountEditFields account={account} compact autoFocus />
  </fieldset>;
}

function ResearchFailureRow({ failure, onSaved }: { failure: ResearchFailure; onSaved: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveErrorCount, setSaveErrorCount] = useState(0);
  const [account, setAccount] = useState<WholesaleAccountEditValues | null>(null);
  const request = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const editorId = useId();
  const titleId = useId();

  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    if (!saveErrorCount) return;
    const alert = editor.current?.querySelector<HTMLElement>('[role="alert"]');
    if (alert) { alert.tabIndex = -1; alert.focus(); }
  }, [saveErrorCount]);
  const load = async () => {
    const currentRequest = ++request.current;
    setEditing(true);
    setLoading(true);
    setError('');
    setAccount(null);
    try {
      const result = await loadResearchAccountEditor(failure.accountId);
      if (currentRequest !== request.current) return;
      if ('error' in result) setError(result.error);
      else setAccount(result.account);
    } catch (cause) {
      unstable_rethrow(cause);
      if (currentRequest === request.current) setError('Could not load this account. Try again.');
    } finally {
      if (currentRequest === request.current) setLoading(false);
    }
  };
  const cancel = () => {
    request.current += 1;
    setEditing(false);
    setLoading(false);
    setAccount(null);
    setError('');
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };

  return <article className="research-failure-row">
    <div className="research-failure-summary">
      <div className="research-failure-identity">
        <strong><Link href={`/wholesale/${failure.accountId}`}>{failure.name}</Link></strong>
        <small>{failure.identity}</small>
        <small>{failure.reason}</small>
        {failure.submittedLocation ? <small className="muted">Submitted location: {failure.submittedLocation}</small> : null}
      </div>
      <div className="research-failure-status">
        <strong>Needs correction</strong>
        <small>{failure.failedAt}</small>
        <div className="research-failure-actions">
          <button ref={trigger} className="secondary" type="button" aria-expanded={editing} aria-controls={editorId} aria-label={`Edit ${failure.name}`} disabled={editing} onClick={() => { void load(); }}>Edit</button>
          <Link href={`/wholesale/${failure.accountId}`}>Open restaurant account</Link>
        </div>
      </div>
    </div>
    {editing ? <div ref={editor} className="research-account-editor" id={editorId} role="region" aria-labelledby={titleId} aria-busy={loading}>
      <h3 id={titleId}>Edit {failure.name}</h3>
      {loading ? <><p role="status">Loading account details…</p><button className="secondary" type="button" onClick={cancel}>Cancel</button></> : null}
      {error ? <><p className="notice danger" role="alert">{error}</p><div className="research-edit-actions"><button type="button" onClick={() => { void load(); }}>Try again</button><button className="secondary" type="button" onClick={cancel}>Cancel</button></div></> : null}
      {account ? <ActionForm action={saveResearchAccount} onError={() => setSaveErrorCount(count => count + 1)} onSuccess={() => {
        setEditing(false);
        setAccount(null);
        onSaved(failure.name);
      }}>
        <p className="muted">Correct the account details below. Changes to its name or location return it to the research queue when eligible.</p>
        <EditorFields account={account} />
        <EditorActions onCancel={cancel} />
      </ActionForm> : null}
    </div> : null}
  </article>;
}

export function ResearchFailureList({ failures }: { failures: ResearchFailure[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState({ message: '', sequence: 0 });
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (saved.sequence) notice.current?.focus({ preventScroll: true }); }, [saved.sequence]);
  return <>
    {saved.message ? <p ref={notice} tabIndex={-1} className="toast-notice" role="status">{saved.message}</p> : null}
    {failures.length ? <div className="research-failure-list">{failures.map(failure => <ResearchFailureRow key={failure.id} failure={failure} onSaved={name => {
      setSaved(previous => ({ message: `${name} saved. The failure list has been refreshed.`, sequence: previous.sequence + 1 }));
      router.refresh();
    }} />)}</div> : <div className="empty-state"><h3>No account failures need attention</h3><p>API limits, billing interruptions, and other operational issues are marked unsuccessful and returned to the research queue instead.</p></div>}
  </>;
}
