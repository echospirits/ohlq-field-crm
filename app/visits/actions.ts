'use server';

import { AccountType, PhotoType, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { uploadVisitPhoto, validateVisitPhotoFile } from '../../lib/blob';
import { prisma } from '../../lib/prisma';
import {
  getWholesaleLicenseeIdCreateData,
  getWholesaleLicenseeIdLookupWhere,
  getWholesaleLicenseeIdValues,
  normalizeWholesaleLicenseeId,
  syncWholesaleAccountLicenseeIds,
} from '../../lib/wholesaleAccounts';

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

const toManualLicenseeId = (name: string) => {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'account';

  return `manual-${slug}-${Date.now().toString(36)}`;
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

const redirectVisitWithStatus = (formOrigin: FormOrigin, status: string, locationType: string): never => {
  redirect(
    formOrigin === 'worklist'
      ? `/alerts?notice=${status}`
      : `/visits/new?status=${status}&type=${locationType === 'wholesale' ? 'wholesale' : 'agency'}`,
  );
};

const getVisitSummaryPath = (visit: {
  agencyId: string | null;
  locationType: string;
  wholesaleAccountId: string | null;
}) => {
  if (visit.locationType === 'wholesale' && visit.wholesaleAccountId) {
    return `/wholesale/${visit.wholesaleAccountId}`;
  }

  if (visit.locationType === 'agency' && visit.agencyId) {
    return `/agencies/${visit.agencyId}`;
  }

  return '/visits';
};

const redirectToVisitSummary = (
  visit: {
    agencyId: string | null;
    locationType: string;
    wholesaleAccountId: string | null;
  },
  status = 'visit-logged',
): never => {
  redirect(`${getVisitSummaryPath(visit)}?status=${status}`);
};

function collectPhotos(formData: FormData, formOrigin: FormOrigin, locationType: string) {
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
        redirectVisitWithStatus(formOrigin, validationError, locationType);
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
  const locationType = String(formData.get('locationType') ?? 'wholesale') === 'agency' ? 'agency' : 'wholesale';
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
  const pendingPhotos = collectPhotos(formData, formOrigin, locationType);

  if (locationType === 'agency' && !agencyId) {
    redirectVisitWithStatus(formOrigin, 'invalid-agency', locationType);
  }

  if (locationType === 'wholesale' && !selectedWholesaleAccountId && !newWholesaleName && !newWholesaleLicenseeId) {
    redirectVisitWithStatus(formOrigin, 'invalid-wholesale', locationType);
  }

  const visit = await prisma.$transaction(async (tx) => {
    let wholesaleAccountId = selectedWholesaleAccountId;

    if (locationType === 'wholesale' && !wholesaleAccountId && (newWholesaleLicenseeId || newWholesaleName)) {
      const licenseeId =
        normalizeWholesaleLicenseeId(newWholesaleLicenseeId) ?? toManualLicenseeId(newWholesaleName ?? 'Wholesale account');
      const name = newWholesaleName ?? `Wholesale ${licenseeId}`;
      const officialAccount = newWholesaleLicenseeId
        ? await tx.account.findFirst({
            where: {
              licenseeId: { equals: licenseeId, mode: 'insensitive' },
              type: AccountType.BAR_RESTAURANT,
            },
            select: { id: true },
          })
        : null;
      const existingAccount = newWholesaleLicenseeId
        ? await tx.wholesaleAccount.findFirst({
            where: getWholesaleLicenseeIdLookupWhere(licenseeId),
            select: {
              id: true,
              licenseeId: true,
              licenseeIds: { select: { licenseeId: true } },
            },
          })
        : await tx.wholesaleAccount.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } },
            select: {
              id: true,
              licenseeId: true,
              licenseeIds: { select: { licenseeId: true } },
            },
          });

      const wholesaleAccount = existingAccount
        ? existingAccount
        : await tx.wholesaleAccount.create({
            data: {
              licenseeId,
              licenseeIds: { create: getWholesaleLicenseeIdCreateData([licenseeId]) },
              officialAccountId: officialAccount?.id,
              isActive: true,
              name,
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
          });

      if (existingAccount) {
        await tx.wholesaleAccount.update({
          where: { id: existingAccount.id },
          data: {
            isActive: true,
            officialAccountId: officialAccount?.id ?? undefined,
            name,
            agencyId: toOptional(formData.get('newWholesaleAgencyId')) ?? undefined,
            address: toOptional(formData.get('newWholesaleAddress')) ?? undefined,
            city: toOptional(formData.get('newWholesaleCity')) ?? undefined,
            county: toOptional(formData.get('newWholesaleCounty')) ?? undefined,
            zip: toOptional(formData.get('newWholesaleZip')) ?? undefined,
            phone: toOptional(formData.get('newWholesalePhone')) ?? undefined,
            ownership: toOptional(formData.get('newWholesaleOwnership')) ?? undefined,
            districtId: toOptional(formData.get('newWholesaleDistrictId')) ?? undefined,
            deliveryDay: toOptional(formData.get('newWholesaleDeliveryDay')) ?? undefined,
          },
        });
        if (newWholesaleLicenseeId) {
          await syncWholesaleAccountLicenseeIds(tx, existingAccount.id, [
            ...getWholesaleLicenseeIdValues(existingAccount),
            licenseeId,
          ]);
        }
      }

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
        redirectVisitWithStatus(formOrigin, 'invalid-contact', locationType);
      }

      const selectedContact = contact!;

      if (locationType === 'agency') {
        const selectedAgency = agencyId
          ? await tx.agency.findUnique({ where: { id: agencyId }, select: { agencyId: true } })
          : null;
        const allowedAgencyIds = new Set([agencyId, selectedAgency?.agencyId].filter(Boolean));

        if (!selectedContact.agencyId || !allowedAgencyIds.has(selectedContact.agencyId)) {
          redirectVisitWithStatus(formOrigin, 'invalid-contact', locationType);
        }
      }

      if (locationType === 'wholesale' && selectedContact.wholesaleAccountId !== wholesaleAccountId) {
        redirectVisitWithStatus(formOrigin, 'invalid-contact', locationType);
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
      redirectToVisitSummary(visit, 'visit-logged-photo-upload-failed');
    }
  }

  revalidatePath('/visits');
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  revalidatePath('/tags');
  if (visit.agencyId) {
    revalidatePath(`/agencies/${visit.agencyId}`);
  }
  if (visit.wholesaleAccountId) {
    revalidatePath(`/wholesale/${visit.wholesaleAccountId}`);
  }
  redirectToVisitSummary(visit, worklistItemId ? 'visit-logged-worklist-completed' : 'visit-logged');
}
