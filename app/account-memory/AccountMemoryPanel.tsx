import { getCommunicationHref } from '../../lib/accountMemory';
import { getIPhoneShortcutConfig } from '../../lib/contactImport';
import { CommunicationLink } from './CommunicationLink';
import { ContactImportForm } from './ContactImportForm';
import { saveAccountNotes, updateAccountContact } from './actions';

export type AccountMemoryContact = {
  id: string; name: string; role: string | null; email: string | null; phone: string | null;
  notes: string | null; isPrimary: boolean; active: boolean;
};

type Props = {
  accountId: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  contacts: AccountMemoryContact[];
  notes: string | null;
  returnTo: string;
};

const LocationFields = ({ accountId, accountType, returnTo }: Pick<Props, 'accountId' | 'accountType' | 'returnTo'>) => <>
  <input name="accountId" type="hidden" value={accountId} />
  <input name="accountType" type="hidden" value={accountType} />
  <input name="returnTo" type="hidden" value={returnTo} />
</>;

export function AccountMemoryPanel({ accountId, accountType, contacts, notes, returnTo }: Props) {
  const shortcutConfig = getIPhoneShortcutConfig();
  const active = contacts.filter((contact) => contact.active);
  const inactive = contacts.filter((contact) => !contact.active);
  const renderContact = (contact: AccountMemoryContact) => <article className={`contact-card${contact.active ? '' : ' is-inactive'}`} key={contact.id}>
    <div className="contact-card-heading">
      <span><strong>{contact.name}</strong>{contact.role ? <small>{contact.role}</small> : null}</span>
      <span>{contact.isPrimary ? <span className="pill">Primary</span> : null}{!contact.active ? <small>Inactive</small> : null}</span>
    </div>
    <div className="contact-card-body">
      <div className="contact-actions">
        {contact.email ? <CommunicationLink accountId={accountId} accountType={accountType} contactId={contact.id} href={getCommunicationHref('email', contact.email)} label={contact.email} /> : null}
        {contact.phone ? <CommunicationLink accountId={accountId} accountType={accountType} contactId={contact.id} href={getCommunicationHref('phone', contact.phone)} label={contact.phone} /> : null}
        <a className="btn contact-transfer-button" download href={`/api/contacts/${contact.id}/vcard`}>Save to phone</a>
      </div>
      {contact.notes ? <p className="preserve-lines contact-notes">{contact.notes}</p> : null}
      <details className="nested-details"><summary>Edit contact</summary>
        <form action={updateAccountContact} className="contact-form">
          <LocationFields accountId={accountId} accountType={accountType} returnTo={returnTo} />
          <input name="contactId" type="hidden" value={contact.id} />
          <label>Name<input defaultValue={contact.name} name="name" required /></label>
          <label>Role / title<input defaultValue={contact.role ?? ''} name="role" /></label>
          <label>Email<input defaultValue={contact.email ?? ''} inputMode="email" name="email" type="email" /></label>
          <label>Phone<input defaultValue={contact.phone ?? ''} inputMode="tel" name="phone" type="tel" /></label>
          <label className="contact-form-wide">Contact notes<textarea defaultValue={contact.notes ?? ''} name="notes" rows={3} /></label>
          <label className="checkbox-label"><input defaultChecked={contact.isPrimary} name="isPrimary" type="checkbox" value="true" /> Primary contact</label>
          <label className="checkbox-label"><input defaultChecked={contact.active} name="active" type="checkbox" value="true" /> Active</label>
          <button type="submit">Save contact</button>
        </form>
      </details>
    </div>
  </article>;

  return <section className="account-memory-grid account-workspace-section" id="account-memory">
    <article className="card account-notes-card">
      <div className="section-heading"><h2>Notes</h2></div>
      {notes ? <p className="preserve-lines account-notes-copy">{notes}</p> : <p className="muted">Add account notes.</p>}
      <details className="nested-details"><summary>{notes ? 'Edit notes' : 'Add notes'}</summary>
        <form action={saveAccountNotes}>
          <LocationFields accountId={accountId} accountType={accountType} returnTo={returnTo} />
          <textarea aria-label="Account notes" defaultValue={notes ?? ''} name="notes" placeholder="Best visit time, buyer preferences, or account context" rows={5} />
          <button type="submit">Save notes</button>
        </form>
      </details>
    </article>
    <article className="card account-contacts-card">
      <div className="section-heading"><h2>Contacts</h2><span className="pill">{active.length}</span></div>
      <div className="contact-list">{active.length ? active.map(renderContact) : <p className="muted">No contacts yet.</p>}</div>
      {inactive.length ? <details className="inactive-contacts"><summary>{inactive.length} inactive</summary><div className="contact-list">{inactive.map(renderContact)}</div></details> : null}
      <ContactImportForm accountId={accountId} accountType={accountType} installUrl={shortcutConfig.installUrl} returnTo={returnTo} shortcutVersion={shortcutConfig.version} />
    </article>
  </section>;
}
