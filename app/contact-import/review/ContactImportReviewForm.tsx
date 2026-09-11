'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { createAccountContact } from '../../account-memory/actions';
import { isShortcutUpdateRequired, parseContactImportPayload, type ContactImportPayload } from '../../../lib/contactImportPayload';

type Props = {
  accountId: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  installUrl: string | null;
  requiredVersion: string;
  returnTo: string;
  state: string;
};

const emptyPayload: ContactImportPayload = {
  schemaVersion: 1,
  shortcutVersion: '',
  name: '',
  phones: [],
  emails: [],
  jobTitle: '',
};

export function ContactImportReviewForm({ accountId, accountType, installUrl, requiredVersion, returnTo, state }: Props) {
  const [contact, setContact] = useState(emptyPayload);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>('loading');
  useEffect(() => {
    const storageKey = `neat-contact-import:${state}`;
    const fragmentValue = new URLSearchParams(window.location.hash.slice(1)).get('contact');
    const serialized = fragmentValue || window.sessionStorage.getItem(storageKey);
    try {
      const parsed = parseContactImportPayload(JSON.parse(serialized || 'null'));
      if (!parsed) throw new Error('invalid-payload');
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(parsed));
        if (fragmentValue) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      } catch {}
      setContact(parsed);
      setPhone(parsed.phones[0] ?? '');
      setEmail(parsed.emails[0] ?? '');
      setStatus('ready');
    } catch {
      setStatus('invalid');
    }
  }, [state]);

  const update = (field: 'name' | 'jobTitle') => (event: ChangeEvent<HTMLInputElement>) =>
    setContact((current) => ({ ...current, [field]: event.target.value }));

  if (status === 'loading') return <p className="muted" role="status">Loading the selected contact…</p>;
  if (status === 'invalid') return <div className="contact-import-error" role="alert">
    <h2>Contact information was not returned</h2>
    <p>The Shortcut was cancelled or returned data Neat could not read. No contact was saved.</p>
    <div className="contact-import-review-actions">
      <Link className="btn" href={returnTo}>Return to account</Link>
      {installUrl ? <a className="btn secondary" href={installUrl}>Update Shortcut</a> : null}
    </div>
  </div>;

  const needsUpdate = isShortcutUpdateRequired(contact.shortcutVersion, requiredVersion);
  return <>
    {needsUpdate ? <div className="toast-notice" role="status">
      Your Send to Neat Shortcut is version {contact.shortcutVersion || 'unknown'}; version {requiredVersion} is recommended.
      {installUrl ? <> <a href={installUrl}>Update Shortcut</a></> : null}
    </div> : null}
    <form action={createAccountContact} className="contact-form contact-import-review-form">
      <input name="accountId" type="hidden" value={accountId} />
      <input name="accountType" type="hidden" value={accountType} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="importSessionToken" type="hidden" value={state} />
      <label>Name<input autoComplete="name" name="name" onChange={update('name')} required value={contact.name} /></label>
      <label>Role / title<input autoComplete="organization-title" name="role" onChange={update('jobTitle')} value={contact.jobTitle} /></label>
      <label>Email
        <input autoComplete="email" inputMode="email" name="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        {contact.emails.length > 1 ? <span className="contact-import-options" aria-label="Imported email choices">
          {contact.emails.map((value) => <button className="btn secondary" key={value} onClick={() => setEmail(value)} type="button">{value}</button>)}
        </span> : null}
      </label>
      <label>Phone
        <input autoComplete="tel" inputMode="tel" name="phone" onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
        {contact.phones.length > 1 ? <span className="contact-import-options" aria-label="Imported phone choices">
          {contact.phones.map((value) => <button className="btn secondary" key={value} onClick={() => setPhone(value)} type="button">{value}</button>)}
        </span> : null}
      </label>
      <label className="contact-form-wide">Contact notes<textarea name="notes" rows={3} /></label>
      <label className="checkbox-label"><input name="isPrimary" type="checkbox" value="true" /> Primary contact</label>
      <div className="contact-import-review-actions contact-form-wide">
        <button type="submit">Save contact</button>
        <Link className="btn secondary" href={returnTo}>Cancel</Link>
      </div>
    </form>
  </>;
}
