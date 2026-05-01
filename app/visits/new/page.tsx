export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { PhotoType, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/prisma';

const PHOTO_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

const photoTypes = [
  { value: PhotoType.DISPLAY, label: 'Display' },
  { value: PhotoType.MENU, label: 'Menu' },
  { value: PhotoType.OTHER, label: 'Other' },
];

const statusMessages: Record<string, string> = {
  'invalid-agency': 'Select an agency before logging an agency visit.',
  'invalid-wholesale': 'Select an existing wholesale account or create one before logging a wholesale visit.',
  'invalid-photo': 'Photos must be image files.',
  'photo-too-large': 'Each uploaded photo must be 5 MB or smaller.',
};

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toDate = (value: FormDataEntryValue | null | undefined) => {
  const date = toOptional(value);
  return date ? new Date(`${date}T00:00:00`) : null;
};

const toPhotoType = (value: FormDataEntryValue | undefined) => {
  const requestedType = String(value ?? PhotoType.OTHER);
  return photoTypes.some((photoType) => photoType.value === requestedType)
    ? (requestedType as PhotoType)
    : PhotoType.OTHER;
};

async function collectPhotos(formData: FormData) {
  const types = formData.getAll('photoType');
  const files = formData.getAll('photoFile');
  const urls = formData.getAll('photoUrl');
  const captions = formData.getAll('photoCaption');
  const photoCount = Math.max(types.length, files.length, urls.length, captions.length);
  const photos: Array<{ type: PhotoType; url: string; caption: string | null }> = [];

  for (let index = 0; index < photoCount; index += 1) {
    const type = toPhotoType(types[index]);
    const caption = toOptional(captions[index]);
    let url = toOptional(urls[index]);
    const file = files[index];

    if (file instanceof File && file.size > 0) {
      if (!file.type.startsWith('image/')) {
        redirect('/visits/new?status=invalid-photo');
      }

      if (file.size > PHOTO_UPLOAD_LIMIT_BYTES) {
        redirect('/visits/new?status=photo-too-large');
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      url = `data:${file.type};base64,${buffer.toString('base64')}`;
    }

    if (url) {
      photos.push({ type, url, caption });
    }
  }

  return photos;
}

async function createVisit(formData: FormData) {
  'use server';

  const locationType = String(formData.get('locationType') ?? 'agency') === 'wholesale' ? 'wholesale' : 'agency';
  const agencyId = toOptional(formData.get('agencyId'));
  const selectedWholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const newWholesaleLicenseeId = toOptional(formData.get('newWholesaleLicenseeId'));
  const newWholesaleName = toOptional(formData.get('newWholesaleName'));
  const newContactName = toOptional(formData.get('newContactName'));
  const newContactPhone = toOptional(formData.get('newContactPhone'));
  const summary = toOptional(formData.get('summary'));
  const outcomes = toOptional(formData.get('outcomes'));
  const nextStep = toOptional(formData.get('nextStep'));
  const createdBy = toOptional(formData.get('createdBy'));
  const followUpDate = toDate(formData.get('followUpDate'));
  const photos = await collectPhotos(formData);

  if (locationType === 'agency' && !agencyId) {
    redirect('/visits/new?status=invalid-agency');
  }

  if (locationType === 'wholesale' && !selectedWholesaleAccountId && (!newWholesaleLicenseeId || !newWholesaleName)) {
    redirect('/visits/new?status=invalid-wholesale');
  }

  await prisma.$transaction(async (tx) => {
    let wholesaleAccountId = selectedWholesaleAccountId;

    if (locationType === 'wholesale' && !wholesaleAccountId && newWholesaleLicenseeId && newWholesaleName) {
      const wholesaleAccount = await tx.wholesaleAccount.upsert({
        where: { licenseeId: newWholesaleLicenseeId },
        create: {
          licenseeId: newWholesaleLicenseeId,
          name: newWholesaleName,
          agencyId: toOptional(formData.get('newWholesaleAgencyId')),
          address: toOptional(formData.get('newWholesaleAddress')),
          city: toOptional(formData.get('newWholesaleCity')),
          county: toOptional(formData.get('newWholesaleCounty')),
          zip: toOptional(formData.get('newWholesaleZip')),
          phone: toOptional(formData.get('newWholesalePhone')),
          ownership: toOptional(formData.get('newWholesaleOwnership')),
          districtId: toOptional(formData.get('newWholesaleDistrictId')),
          deliveryDay: toOptional(formData.get('newWholesaleDeliveryDay')),
        },
        update: {
          name: newWholesaleName,
          agencyId: toOptional(formData.get('newWholesaleAgencyId')),
          address: toOptional(formData.get('newWholesaleAddress')),
          city: toOptional(formData.get('newWholesaleCity')),
          county: toOptional(formData.get('newWholesaleCounty')),
          zip: toOptional(formData.get('newWholesaleZip')),
          phone: toOptional(formData.get('newWholesalePhone')),
          ownership: toOptional(formData.get('newWholesaleOwnership')),
          districtId: toOptional(formData.get('newWholesaleDistrictId')),
          deliveryDay: toOptional(formData.get('newWholesaleDeliveryDay')),
        },
      });

      wholesaleAccountId = wholesaleAccount.id;
    }

    let contactId = toOptional(formData.get('contactId'));

    if (newContactName) {
      const createdContact = await tx.locationContact.create({
        data: {
          name: newContactName,
          phone: newContactPhone,
          agencyId: locationType === 'agency' ? agencyId : null,
          wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
        },
      });
      contactId = createdContact.id;
    }

    const visit = await tx.loggedVisit.create({
      data: {
        locationType,
        agencyId: locationType === 'agency' ? agencyId : null,
        wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
        contactId,
        summary,
        outcomes,
        nextStep,
        createdBy,
        followUpDate,
      },
    });

    if (photos.length > 0) {
      await tx.visitPhoto.createMany({
        data: photos.map((photo) => ({
          loggedVisitId: visit.id,
          type: photo.type,
          url: photo.url,
          caption: photo.caption,
        })),
      });
    }

    if (followUpDate) {
      await tx.worklistItem.create({
        data: {
          title: nextStep ? `Follow up: ${nextStep.slice(0, 120)}` : 'Follow up on visit',
          detail: [
            summary ? `Summary: ${summary}` : null,
            outcomes ? `Outcomes: ${outcomes}` : null,
            nextStep ? `Next step: ${nextStep}` : null,
          ]
            .filter(Boolean)
            .join('\n') || null,
          status: WorklistStatus.OPEN,
          source: WorklistSource.VISIT_FOLLOW_UP,
          category: locationType === 'agency' ? WorklistCategory.AGENCY : WorklistCategory.WHOLESALE,
          agencyId: locationType === 'agency' ? agencyId : null,
          wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
          loggedVisitId: visit.id,
          dueDate: followUpDate,
          assignedTo: createdBy,
          createdBy,
        },
      });
    }
  });

  revalidatePath('/visits');
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/wholesale');
  redirect('/visits?status=logged');
}

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const agencies = await prisma.agency.findMany({ orderBy: { name: 'asc' }, take: 500 });
  const wholesaleAccounts = await prisma.wholesaleAccount.findMany({ orderBy: { name: 'asc' }, take: 500 });
  const contacts = await prisma.locationContact.findMany({ orderBy: { name: 'asc' }, take: 1000 });

  return (
    <>
      <h1>Log Visit</h1>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}

      <div className="card">
        <form action={createVisit} encType="multipart/form-data">
          <fieldset>
            <legend>Location</legend>
            <label>Location type</label>
            <select name="locationType">
              <option value="agency">Agency</option>
              <option value="wholesale">Wholesale</option>
            </select>

            <label>Agency</label>
            <select name="agencyId">
              <option value="">-- Select agency for agency visits --</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name} ({agency.agencyId})
                </option>
              ))}
            </select>

            <label>Existing wholesale account</label>
            <select name="wholesaleAccountId">
              <option value="">-- Select wholesale or create one below --</option>
              {wholesaleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.licenseeId})
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset>
            <legend>Create wholesale account on the fly</legend>
            <div className="form-grid">
              <input name="newWholesaleLicenseeId" placeholder="Licensee ID" />
              <input name="newWholesaleName" placeholder="Account name" />
              <input name="newWholesaleAgencyId" placeholder="Agency ID" />
              <input name="newWholesalePhone" placeholder="Phone" />
              <input name="newWholesaleAddress" placeholder="Address" />
              <input name="newWholesaleCity" placeholder="City" />
              <input name="newWholesaleCounty" placeholder="County" />
              <input name="newWholesaleZip" placeholder="Zip" />
              <input name="newWholesaleOwnership" placeholder="Ownership" />
              <input name="newWholesaleDistrictId" placeholder="District ID" />
              <input name="newWholesaleDeliveryDay" placeholder="Delivery Day" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Contact</legend>
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
            <div className="form-grid">
              <input name="newContactName" placeholder="Contact name" />
              <input name="newContactPhone" placeholder="Contact phone" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Visit notes</legend>
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
          </fieldset>

          <fieldset>
            <legend>Photos</legend>
            {[1, 2, 3].map((photoNumber) => (
              <div className="photo-entry" key={photoNumber}>
                <h3>Photo {photoNumber}</h3>
                <select name="photoType" defaultValue={PhotoType.DISPLAY}>
                  {photoTypes.map((photoType) => (
                    <option key={photoType.value} value={photoType.value}>
                      {photoType.label}
                    </option>
                  ))}
                </select>
                <input name="photoFile" type="file" accept="image/*" />
                <input name="photoUrl" type="url" placeholder="Or paste a photo URL" />
                <input name="photoCaption" placeholder="Caption or note" />
              </div>
            ))}
          </fieldset>

          <button type="submit">Log visit</button>
        </form>
      </div>
    </>
  );
}
