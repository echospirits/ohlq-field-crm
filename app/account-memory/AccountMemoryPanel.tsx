import { AnchoredDetails } from '../components/AnchoredDetails';
import { RecordPicker } from '../components/RecordPicker';
import { ContactRelationships } from './ContactRelationships';
import { SubmitButton } from '../components/SubmitButton';
import { getCommunicationHref } from '../../lib/accountMemory';
import { getIPhoneShortcutConfig } from '../../lib/contactImport';
import { CommunicationLink } from './CommunicationLink';
import { ContactImportForm } from './ContactImportForm';
import { saveAccountNotes, updateAccountContact } from './actions';

export type AccountMemoryContact = {
  id: string; name: string; role: string | null; email: string | null; phone: string | null;
  relationshipOwnerId?: string | null; emailAliases?: string[]; phoneAliases?: string[]; preferredChannel?: string | null; decisionAuthority?: string | null; influenceLevel?: string | null; personKey?: string | null;
  notes: string | null; isPrimary: boolean; active: boolean;
};

type Props = {
  accountId: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  contacts: AccountMemoryContact[];
  users?: Array<{ id: string; name: string }>;
  notes: string | null;
  returnTo: string;
};

const LocationFields = ({ accountId, accountType, returnTo }: Pick<Props, 'accountId' | 'accountType' | 'returnTo'>) => <>
  <input name="accountId" type="hidden" value={accountId} />
  <input name="accountType" type="hidden" value={accountType} />
  <input name="returnTo" type="hidden" value={returnTo} />
</>;

export function AccountMemoryPanel({ accountId, accountType, contacts, notes, returnTo, users = [] }: Props) {
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
          <RecordPicker label="Relationship owner" name="relationshipOwnerId" options={users.map(user => ({ value: user.id, label: user.name }))} defaultValue={contact.relationshipOwnerId ?? ""} placeholder="Unassigned" clearLabel="Unassigned" />
          <label>Other phone numbers<input name="phoneAliases" defaultValue={contact.phoneAliases?.join(', ') ?? ''} placeholder="Separate with commas" /></label><label>Other email addresses<input name="emailAliases" defaultValue={contact.emailAliases?.join(', ') ?? ''} placeholder="Separate with commas" /></label>
          <label>Preferred channel<select name="preferredChannel" defaultValue={contact.preferredChannel ?? ''}><option value="">Not recorded</option><option value="EMAIL">Email</option><option value="PHONE">Phone</option><option value="SMS">Text</option><option value="IN_PERSON">In person</option></select></label>
          <label>Decision role<select name="decisionAuthority" defaultValue={contact.decisionAuthority ?? ''}><option value="">Not recorded</option><option value="DECISION_MAKER">Decision maker</option><option value="BUYER">Buyer</option><option value="INFLUENCER">Influencer</option><option value="COORDINATOR">Event coordinator</option><option value="OTHER">Other</option></select></label>
          <label>Influence<select name="influenceLevel" defaultValue={contact.influenceLevel ?? ''}><option value="">Not recorded</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>
          <label className="contact-form-wide">Contact notes<textarea defaultValue={contact.notes ?? ''} name="notes" rows={3} /></label>
          <label className="checkbox-label"><input defaultChecked={contact.isPrimary} name="isPrimary" type="checkbox" value="true" /> Primary contact</label>
          <label className="checkbox-label"><input defaultChecked={contact.active} name="active" type="checkbox" value="true" /> Active</label>
          <SubmitButton type="submit">Save contact</SubmitButton>
        </form>
      </details>
      {contact.active ? <ContactRelationships id={contact.id} email={contact.email} personKey={contact.personKey} /> : null}
    </div>
  </article>;

  return <section className="account-memory-grid account-workspace-section" id="account-memory">
    <article className="card account-notes-card">
      <div className="section-heading"><h2>Notes</h2></div>
      {notes ? <p className="preserve-lines account-notes-copy">{notes}</p> : <p className="muted">No account notes yet.</p>}
      <details className="nested-details"><summary>{notes ? 'Edit notes' : 'Add notes'}</summary>
        <form action={saveAccountNotes}>
          <LocationFields accountId={accountId} accountType={accountType} returnTo={returnTo} />
          <textarea aria-label="Account notes" defaultValue={notes ?? ''} name="notes" placeholder="Best visit time, buyer preferences, or account context" rows={5} />
          <SubmitButton type="submit">Save notes</SubmitButton>
        </form>
      </details>
    </article>
    <article className="card account-contacts-card">
      <div className="section-heading"><h2>Contacts</h2><span className="pill">{active.length}</span></div>
      <div className="contact-list">{active.length ? active.map(renderContact) : <p className="muted">No contacts yet.</p>}</div>
      {inactive.length ? <details className="inactive-contacts"><summary>{inactive.length} inactive</summary><div className="contact-list">{inactive.map(renderContact)}</div></details> : null}
      <AnchoredDetails className="contact-import-disclosure" id="account-contact-editor" summary="Add or import a contact"><ContactImportForm accountId={accountId} accountType={accountType} installUrl={shortcutConfig.installUrl} returnTo={returnTo} shortcutVersion={shortcutConfig.version} /></AnchoredDetails>
    </article>
  </section>;
}
