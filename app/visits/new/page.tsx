export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/prisma';

async function createVisit(formData: FormData) {
  'use server';

  const locationType = String(formData.get('locationType') ?? 'agency');
  const agencyId = String(formData.get('agencyId') ?? '').trim() || null;
  const wholesaleAccountId = String(formData.get('wholesaleAccountId') ?? '').trim() || null;
  let contactId = String(formData.get('contactId') ?? '').trim() || null;

  const newContactName = String(formData.get('newContactName') ?? '').trim();
  const newContactPhone = String(formData.get('newContactPhone') ?? '').trim();

  if (newContactName) {
    const createdContact = await prisma.locationContact.create({
      data: {
        name: newContactName,
        phone: newContactPhone || null,
        agencyId: locationType === 'agency' ? agencyId : null,
        wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
      },
    });
    contactId = createdContact.id;
  }

  await prisma.loggedVisit.create({
    data: {
      locationType,
      agencyId: locationType === 'agency' ? agencyId : null,
      wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
      contactId,
      summary: String(formData.get('summary') ?? '').trim() || null,
      outcomes: String(formData.get('outcomes') ?? '').trim() || null,
      nextStep: String(formData.get('nextStep') ?? '').trim() || null,
      createdBy: String(formData.get('createdBy') ?? '').trim() || null,
      followUpDate: String(formData.get('followUpDate') ?? '').trim()
        ? new Date(String(formData.get('followUpDate')))
        : null,
    },
  });

  revalidatePath('/visits');
  redirect('/visits');
}

export default async function NewVisitPage() {
  const agencies = await prisma.agency.findMany({ orderBy: { name: 'asc' }, take: 500 });
  const wholesaleAccounts = await prisma.wholesaleAccount.findMany({ orderBy: { name: 'asc' }, take: 500 });
  const contacts = await prisma.locationContact.findMany({ orderBy: { name: 'asc' }, take: 1000 });

  return (
    <>
      <h1>Log Visit</h1>
      <div className="card">
        <form action={createVisit}>
          <label>Location type</label>
          <select name="locationType">
            <option value="agency">Agency</option>
            <option value="wholesale">Wholesale</option>
          </select>

          <label>Agency (if agency visit)</label>
          <select name="agencyId">
            <option value="">-- Select agency --</option>
            {agencies.map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name} ({agency.agencyId})
              </option>
            ))}
          </select>

          <label>Wholesale account (if wholesale visit)</label>
          <select name="wholesaleAccountId">
            <option value="">-- Select wholesale --</option>
            {wholesaleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.licenseeId})
              </option>
            ))}
          </select>

          <label>Existing contact</label>
          <select name="contactId">
            <option value="">-- Optional --</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>

          <label>Or create contact on the fly</label>
          <input name="newContactName" placeholder="Contact name" />
          <input name="newContactPhone" placeholder="Contact phone" />

          <label>Visit summary</label>
          <textarea name="summary" rows={3} placeholder="What happened during the visit?" />

          <label>Outcomes</label>
          <textarea name="outcomes" rows={3} placeholder="Wins, losses, placement notes" />

          <label>Next step</label>
          <textarea name="nextStep" rows={2} placeholder="What should happen next?" />

          <label>Follow-up date</label>
          <input name="followUpDate" type="date" />

          <label>Created by</label>
          <input name="createdBy" placeholder="Rep name" />

          <button type="submit">Log visit</button>
        </form>
      </div>
    </>
  );
}
