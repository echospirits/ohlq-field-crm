'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { parseVCard, type ImportedContact } from '../../lib/vCard';
import { createAccountContact } from './actions';

type Props = {
  accountId: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  installUrl: string | null;
  returnTo: string;
  shortcutVersion: string;
};

const emptyContact: ImportedContact = { email: '', externalSourceId: '', name: '', notes: '', phone: '', role: '' };

export function ContactImportForm({ accountId, accountType, installUrl, returnTo, shortcutVersion }: Props) {
  const [contact, setContact] = useState(emptyContact);
  const [message, setMessage] = useState('');
  const [source, setSource] = useState('');
  const [startingShortcut, setStartingShortcut] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const revealForm = (next: ImportedContact, nextSource: string, nextMessage: string) => {
    setContact(next);
    setSource(nextSource);
    setMessage(nextMessage);
    if (detailsRef.current) detailsRef.current.open = true;
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1_000_000) {
      setMessage('That contact file is too large. Choose a .vcf file under 1 MB.');
      return;
    }
    try {
      const parsed = parseVCard(await file.text());
      if (!parsed.name) throw new Error('missing-name');
      revealForm(parsed, 'VCARD_IMPORT', 'Contact imported. Review the details, then add it to Neat.');
    } catch {
      setMessage('Neat could not read that contact. Choose a standard .vcf contact file.');
    }
  };

  const importFromIPhone = async () => {
    setStartingShortcut(true);
    setMessage('Opening Send to Neat…');
    try {
      const response = await fetch('/api/contact-import/iphone/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, accountType }),
      });
      const result = await response.json() as { launchUrl?: string };
      if (!response.ok || !result.launchUrl) throw new Error('shortcut-start-failed');
      window.location.assign(result.launchUrl);
      setMessage('If Shortcuts did not open, install or update Send to Neat below.');
    } catch {
      setMessage('Neat could not start the iPhone import. You can still upload an exported .vcf file.');
    } finally {
      setStartingShortcut(false);
    }
  };

  const update = (field: keyof ImportedContact) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContact((current) => ({ ...current, [field]: event.target.value }));

  return <div className="contact-import-tile">
    <div className="contact-import-heading">
      <div><strong>Add a contact</strong><small>Use the iPhone Shortcut or upload an exported .vcf contact card.</small></div>
      <div className="contact-import-buttons">
        <button className="btn contact-transfer-button" disabled={startingShortcut} onClick={importFromIPhone} type="button">{startingShortcut ? 'Opening…' : 'Import from iPhone'}</button>
        <button className="btn secondary contact-transfer-button" onClick={() => fileRef.current?.click()} type="button">Upload .vcf</button>
      </div>
      <input accept=".vcf,text/vcard,text/x-vcard" aria-label="Upload a vCard contact" className="visually-hidden" onChange={importFile} ref={fileRef} type="file" />
    </div>
    <p className="contact-shortcut-help">
      Send to Neat version {shortcutVersion} is recommended.
      {installUrl ? <> <a href={installUrl}>Install or update the Shortcut</a>.</> : <> Ask your administrator for the installation link.</>}
    </p>
    {message ? <p aria-live="polite" className="contact-import-message">{message}</p> : null}
    <details className="nested-details add-contact" ref={detailsRef}>
      <summary>Enter or review contact</summary>
      <form action={createAccountContact} className="contact-form">
        <input name="accountId" type="hidden" value={accountId} />
        <input name="accountType" type="hidden" value={accountType} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <input name="source" type="hidden" value={source} />
        <input name="externalSourceId" type="hidden" value={contact.externalSourceId} />
        <label>Name<input name="name" onChange={update('name')} required value={contact.name} /></label>
        <label>Role / title<input name="role" onChange={update('role')} value={contact.role} /></label>
        <label>Email<input inputMode="email" name="email" onChange={update('email')} type="email" value={contact.email} /></label>
        <label>Phone<input inputMode="tel" name="phone" onChange={update('phone')} type="tel" value={contact.phone} /></label>
        <label className="contact-form-wide">Contact notes<textarea name="notes" onChange={update('notes')} rows={3} value={contact.notes} /></label>
        <label className="checkbox-label"><input name="isPrimary" type="checkbox" value="true" /> Primary contact</label>
        <button type="submit">Add contact</button>
      </form>
    </details>
  </div>;
}
