'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { parseVCard, type ImportedContact } from '../../lib/vCard';
import { createAccountContact } from './actions';

type Props = { accountId: string; accountType: 'AGENCY' | 'WHOLESALE'; returnTo: string };
type PhoneContact = { email?: string[]; name?: string[]; tel?: string[] };
type ContactsManager = {
  getProperties: () => Promise<string[]>;
  select: (properties: string[], options: { multiple: boolean }) => Promise<PhoneContact[]>;
};

const emptyContact: ImportedContact = { email: '', externalSourceId: '', name: '', notes: '', phone: '', role: '' };

export function ContactImportForm({ accountId, accountType, returnTo }: Props) {
  const [contact, setContact] = useState(emptyContact);
  const [message, setMessage] = useState('');
  const [source, setSource] = useState('');
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

  const choosePhoneContact = async () => {
    const contacts = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
    if (!contacts?.select) {
      fileRef.current?.click();
      return;
    }
    try {
      const supported = await contacts.getProperties();
      const properties = ['name', 'email', 'tel'].filter((property) => supported.includes(property));
      const picked = (await contacts.select(properties, { multiple: false }))[0];
      if (!picked) return;
      const next = {
        ...emptyContact,
        name: picked.name?.[0]?.trim() ?? '',
        email: picked.email?.[0]?.trim() ?? '',
        phone: picked.tel?.[0]?.trim() ?? '',
      };
      if (!next.name) throw new Error('missing-name');
      revealForm(next, 'PHONE_CONTACT_PICKER', 'Contact selected. Review the details, then add it to Neat.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('The phone contact picker was unavailable. Choose an exported .vcf file instead.');
      fileRef.current?.click();
    }
  };

  const update = (field: keyof ImportedContact) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContact((current) => ({ ...current, [field]: event.target.value }));

  return <div className="contact-import-tile">
    <div className="contact-import-heading">
      <div><strong>Add a contact</strong><small>Uses your phone’s contact picker when available; otherwise choose an exported .vcf file.</small></div>
      <button className="btn contact-transfer-button" onClick={choosePhoneContact} type="button">Import from phone</button>
      <input accept=".vcf,text/vcard,text/x-vcard" aria-label="Upload a vCard contact" className="visually-hidden" onChange={importFile} ref={fileRef} type="file" />
    </div>
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
