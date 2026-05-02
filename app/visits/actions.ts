'use server';

import { PhotoType, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { uploadVisitPhoto, validateVisitPhotoFile } from '../../lib/blob';
import { prisma } from '../../lib/prisma';

const photoTypes: PhotoType[] = [PhotoType.DISPLAY, PhotoType.MENU, PhotoType.OTHER];

type FormOrigin = 'visits' | 'worklist';

type PendingPhoto = {
  type: PhotoType;
  file: File | null;
  url: string | null;
  caption: string | null;
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
  return photoTypes.includes(requestedType as PhotoType) ? (requestedType as PhotoType) : PhotoType.OTHER;
};

const getFormOrigin = (formData: FormData): FormOrigin =>
  toOptional(formData.get('formOrigin')) === 'worklist' ? 'worklist' : 'visits';

const getSelectedTagIds = (formData: FormData) =>
  Array.from(
    new Set(
      formData
        .getAll('newWholesaleTagId')
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  );

const getQuickOutcomes = (formData: FormData) =>
  Array.from(
    new Set(
      formData
        .getAll('quickOutcome')
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  );

const redirectWithStatus = (formOrigin: FormOrigin, status: string): never => {
  redirect(formOrigin === 'worklist' ? `/alerts?notice=${status}` : `/visits/new?status=${status}`);
};

function collectPhotos(formData: FormData, formOrigin: FormOrigin) {
  const types = formData.getAll('photoType');
  const files = formData.getAll('photoFile');
  const urls = formData.getAll('photoUrl');
  const captions = formData.getAll('photoCaption');
  const photoCount = Math.max(types.length, files.length, urls.length, captions.length);
  const photos: PendingPhoto[] = [];

  for (let index = 0; index < photoCount; index += 1) {
    const file = files[index];
    const url = toOptional(urls[index]);

    if (file instanceof File && file.size > 0) {
      const validationError = validateVisitPhotoFile(file);

      if (validationError) {
        redirectWithStatus(formOrigin, validationError);
      }

      photos.push({
        type: toPhotoType(types[index]),
        file,
        url: null,
        caption: toOptional(captions[index]),
      });
    } else if (url) {
      photos.push({
        type: toPhotoType(types[index]),
        file: null,
        url,
        caption: toOptional(captions[index]),
      });
    }
  }

  return photos;
}

export async function createVisit(formData: FormData) {
  const user = await requireUser();
  const actorName = getUserDisplayName(user);
  const formOrigin = getFormOrigin(formData);
  const worklistItemId = toOptional(formData.get('worklistItemId'));
  const locationType = String(formData.get('locationType') ?? 'agency') === 'wholesale' ? 'wholesale' : 'agency';
  const agencyId = toOptional(formData.get('agencyId'));
  const selectedWholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  const newWholesaleLicenseeId = toOptional(formData.get('newWholesaleLicenseeId'));
  const newWholesaleName = toOptional(formData.get('newWholesaleName'));
  const newContactName = toOptional(formData.get('newContactName'));
  const newContactPhone = toOptional(formData.get('newContactPhone'));
  const summary = toOptional(formData.get('summary'));
  const quickOutcomes = getQuickOutcomes(formData);
  const typedOutcomes = toOptional(formData.get('outcomes'));
  const outcomes =
    [
      quickOutcomes.length > 0 ? `Quick outcomes: ${quickOutcomes.join(', ')}` : null,
      typedOutcomes,
    ]
      .filter(Boolean)
      .join('\n') || null;
  const nextStep = toOptional(formData.get('nextStep'));
  const followUpDate = toDate(formData.get('followUpDate'));
  const selectedTagIds = getSelectedTagIds(formData);
  const pendingPhotos = collectPhotos(formData, formOrigin);

  if (locationType === 'agency' && !agencyId) {
    redirectWithStatus(formOrigin, 'invalid-agency');
  }

  if (locationType === 'wholesale' && !selectedWholesaleAccountId && (!newWholesaleLicenseeId || !newWholesaleName)) {
    redirectWithStatus(formOrigin, 'invalid-wholesale');
  }

  const visit = await prisma.$transaction(async (tx) => {
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
          createdByUserId: user.id,
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

    if (locationType === 'wholesale' && wholesaleAccountId && selectedTagIds.length > 0) {
      await tx.locationTag.createMany({
        data: selectedTagIds.map((tagId) => ({
          tagId,
          wholesaleAccountId,
          note: 'Applied during visit logging',
          createdByUserId: user.id,
        })),
        skipDuplicates: true,
      });
    }

    let contactId = toOptional(formData.get('contactId'));

    if (contactId) {
      const contact = await tx.locationContact.findUnique({
        where: { id: contactId },
        select: { agencyId: true, wholesaleAccountId: true },
      });

      if (!contact) {
        redirectWithStatus(formOrigin, 'invalid-contact');
      }

      const selectedContact = contact!;

      if (locationType === 'agency') {
        const selectedAgency = agencyId
          ? await tx.agency.findUnique({ where: { id: agencyId }, select: { agencyId: true } })
          : null;
        const allowedAgencyIds = new Set([agencyId, selectedAgency?.agencyId].filter(Boolean));

        if (!selectedContact.agencyId || !allowedAgencyIds.has(selectedContact.agencyId)) {
          redirectWithStatus(formOrigin, 'invalid-contact');
        }
      }

      if (locationType === 'wholesale' && selectedContact.wholesaleAccountId !== wholesaleAccountId) {
        redirectWithStatus(formOrigin, 'invalid-contact');
      }
    }

    if (newContactName) {
      const createdContact = await tx.locationContact.create({
        data: {
          name: newContactName,
          phone: newContactPhone,
          agencyId: locationType === 'agency' ? agencyId : null,
          wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
          createdByUserId: user.id,
        },
      });
      contactId = createdContact.id;
    }

    const loggedVisit = await tx.loggedVisit.create({
      data: {
        locationType,
        agencyId: locationType === 'agency' ? agencyId : null,
        wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
        contactId,
        summary,
        outcomes,
        nextStep,
        createdBy: actorName,
        createdByUserId: user.id,
        followUpDate,
      },
    });

    if (followUpDate) {
      await tx.worklistItem.create({
        data: {
          title: nextStep ? `Follow up: ${nextStep.slice(0, 120)}` : 'Follow up on visit',
          detail:
            [
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
          loggedVisitId: loggedVisit.id,
          dueDate: followUpDate,
          assignedTo: actorName,
          assignedToUserId: user.id,
          createdBy: actorName,
          createdByUserId: user.id,
        },
      });
    }

    if (worklistItemId) {
      await tx.worklistItem.update({
        where: { id: worklistItemId },
        data: {
          status: WorklistStatus.COMPLETED,
          completedAt: new Date(),
          completedByUserId: user.id,
          cancelledAt: null,
          cancelledByUserId: null,
          loggedVisitId: loggedVisit.id,
        },
      });
    }

    return loggedVisit;
  });

  if (pendingPhotos.length > 0) {
    try {
      const photos = await Promise.all(
        pendingPhotos.map(async (photo, index) => {
          if (photo.file) {
            const uploadedPhoto = await uploadVisitPhoto(photo.file, visit.id, user.id, index);

            return {
              loggedVisitId: visit.id,
              type: photo.type,
              url: uploadedPhoto.url,
              storageKey: uploadedPhoto.storageKey,
              contentType: uploadedPhoto.contentType,
              sizeBytes: uploadedPhoto.sizeBytes,
              caption: photo.caption,
              createdByUserId: user.id,
            };
          }

          return {
            loggedVisitId: visit.id,
            type: photo.type,
            url: photo.url ?? '',
            storageKey: null,
            contentType: null,
            sizeBytes: null,
            caption: photo.caption,
            createdByUserId: user.id,
          };
        }),
      );

      await prisma.visitPhoto.createMany({ data: photos });
    } catch {
      redirectWithStatus(formOrigin, 'photo-upload-failed');
    }
  }

  revalidatePath('/visits');
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  revalidatePath('/tags');
  redirect(worklistItemId ? '/alerts?notice=visit-logged' : '/visits?status=logged');
}
