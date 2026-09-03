'use server';

import { AccountType, OpportunityEventType, PhotoType, UserRole, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import {
  deleteStoredPhoto,
  uploadVisitPhoto,
  validateVisitPhotoFile,
  verifyClientUploadedVisitPhoto,
} from '../../lib/blob';
import { prisma } from '../../lib/prisma';
import { hasFeature, requireOrganizationContext } from '../../lib/organizations';
import { getGeocodeResetForAddressChange } from '../../lib/location/geocode';
import { parseTimeInputToMinutes } from '../../lib/dateTime';
import { syncWorklistItemCalendar } from '../../lib/calendar/worklistSync';
import { evaluateOpportunityIntelligence } from '../../lib/opportunityEngine';
import { getSelectedVoiceFollowUps } from '../../lib/voiceVisitNoteShared';
import {
  getOutcomeLabels,
  getRequestedWorklistCompletionIds,
  getVisitTaskEditPlan,
  normalizeFollowUpMode,
  sanitizeOutcomeCodes,
  shouldCreateVisitTask,
} from '../../lib/visitWorkflow';
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
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  caption: string | null;
};

const getErrorLogDetails = (error: unknown) =>
  error instanceof Error ? { message: error.message, name: error.name } : { message: String(error), name: 'UnknownError' };

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

const getOutcomeCodes = (formData: FormData) =>
  Array.from(
    new Set(
      formData
        .getAll('outcomeCode')
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

const redirectToVisitConfirmation = (
  visitId: string,
  formOrigin: FormOrigin,
  status = 'success',
): never => {
  const params = new URLSearchParams({
    visitId,
    origin: formOrigin,
    status,
  });

  redirect(`/visits/confirmed?${params.toString()}`);
};

function collectPhotos(formData: FormData, formOrigin: FormOrigin, locationType: string) {
  const types = formData.getAll('photoType');
  const files = formData.getAll('photoFile');
  const urls = formData.getAll('photoUrl');
  const storageKeys = formData.getAll('photoStorageKey');
  const contentTypes = formData.getAll('photoContentType');
  const sizes = formData.getAll('photoSizeBytes');
  const captions = formData.getAll('photoCaption');
  const photoCount = Math.max(
    types.length,
    files.length,
    urls.length,
    storageKeys.length,
    contentTypes.length,
    sizes.length,
    captions.length,
  );
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
        storageKey: null,
        contentType: file.type,
        sizeBytes: file.size,
        caption: toOptional(captions[index]),
      });
    } else if (url) {
      const requestedSize = Number(toOptional(sizes[index]));
      photos.push({
        type: toPhotoType(types[index]),
        file: null,
        url,
        storageKey: toOptional(storageKeys[index]),
        contentType: toOptional(contentTypes[index]),
        sizeBytes: Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : null,
        caption: toOptional(captions[index]),
      });
    }
  }

  return photos;
}

export async function createVisit(formData: FormData) {
  const user = await requireUser({ allowTaster: true });
  const { organizationId } = await requireOrganizationContext(user);
  const isTaster = user.role === UserRole.TASTER;
  const actorName = getUserDisplayName(user);
  const formOrigin = isTaster ? 'visits' : getFormOrigin(formData);
  const worklistItemId = isTaster ? null : toOptional(formData.get('worklistItemId'));
  const salesOpportunityId = isTaster ? null : toOptional(formData.get('opportunityId'));
  const agencyProductIntelligenceId = isTaster ? null : toOptional(formData.get('agencyProductIntelligenceId'));
  const requestedWorklistCompletionIds = isTaster
    ? []
    : getRequestedWorklistCompletionIds(formData.entries());
  const submissionKey = isTaster ? null : toOptional(formData.get('submissionKey'));
  const locationType = isTaster
    ? 'agency'
    : String(formData.get('locationType') ?? 'wholesale') === 'agency'
      ? 'agency'
      : 'wholesale';
  const agencyId = toOptional(formData.get('agencyId'));
  const selectedWholesaleAccountId = isTaster ? null : toOptional(formData.get('wholesaleAccountId'));
  const newWholesaleLicenseeId = isTaster ? null : toOptional(formData.get('newWholesaleLicenseeId'));
  const newWholesaleName = isTaster ? null : toOptional(formData.get('newWholesaleName'));
  const newContactName = isTaster ? null : toOptional(formData.get('newContactName'));
  const newContactPhone = isTaster ? null : toOptional(formData.get('newContactPhone'));
  const summary = toOptional(formData.get('summary'));
  const outcomeCodes = isTaster ? [] : sanitizeOutcomeCodes(locationType, getOutcomeCodes(formData));
  const outcomeLabels = getOutcomeLabels(locationType, outcomeCodes);
  const typedOutcomes = isTaster ? null : toOptional(formData.get('outcomes'));
  const outcomes =
    [
      outcomeLabels.length > 0 ? outcomeLabels.join(', ') : null,
      typedOutcomes,
    ]
      .filter(Boolean)
      .join('\n') || null;
  const requestedFollowUpMode = isTaster ? 'none' : normalizeFollowUpMode(toOptional(formData.get('followUpMode')));
  const nextStep = requestedFollowUpMode === 'none' ? null : toOptional(formData.get('nextStep'));
  const followUpDate = requestedFollowUpMode === 'none' ? null : toDate(formData.get('followUpDate'));
  const followUpTimeMinutes = followUpDate ? parseTimeInputToMinutes(formData.get('followUpTime')) : null;
  const requestedFollowUpAssigneeId = requestedFollowUpMode === 'task'
    ? toOptional(formData.get('followUpAssignedToUserId')) ?? user.id
    : null;
  const followUpAssignee = requestedFollowUpAssigneeId
    ? await prisma.user.findFirst({ where: { id: requestedFollowUpAssigneeId, organizationId, isActive: true, role: { notIn: [UserRole.TASTER, UserRole.PLATFORM_ADMIN] } } })
    : null;
  if (requestedFollowUpAssigneeId && !followUpAssignee) redirectVisitWithStatus(formOrigin, 'invalid-assignee', locationType);
  const followUpAssigneeName = followUpAssignee ? getUserDisplayName(followUpAssignee) : actorName;
  const selectedVoiceFollowUps = isTaster ? [] : getSelectedVoiceFollowUps(formData);
  const selectedTagIds = isTaster ? [] : getSelectedTagIds(formData);
  const collectedPhotos = collectPhotos(formData, formOrigin, locationType);
  const photoUploadSessionId = toOptional(formData.get('photoUploadSessionId'));

  if (submissionKey) {
    const existingVisit = await prisma.loggedVisit.findUnique({
      where: { organizationId_submissionKey: { organizationId, submissionKey } },
      select: { createdByUserId: true, id: true },
    });
    if (existingVisit?.createdByUserId === user.id) redirectToVisitConfirmation(existingVisit.id, formOrigin);
  }

  if (isTaster && !summary) {
    redirectVisitWithStatus(formOrigin, 'comments-required', locationType);
  }

  if (isTaster && (collectedPhotos.length !== 1 || (!collectedPhotos[0]?.file && !collectedPhotos[0]?.storageKey))) {
    redirectVisitWithStatus(formOrigin, 'photo-required', locationType);
  }

  let pendingPhotos = isTaster
    ? collectedPhotos.map((photo) => ({ ...photo, type: PhotoType.OTHER, caption: null }))
    : collectedPhotos;

  if (locationType === 'agency' && !agencyId) {
    redirectVisitWithStatus(formOrigin, 'invalid-agency', locationType);
  }

  if (
    isTaster &&
    agencyId &&
    !(await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true },
    }))
  ) {
    redirectVisitWithStatus(formOrigin, 'invalid-agency', locationType);
  }

  if (locationType === 'wholesale' && !selectedWholesaleAccountId && !newWholesaleName && !newWholesaleLicenseeId) {
    redirectVisitWithStatus(formOrigin, 'invalid-wholesale', locationType);
  }

  const [salesOpportunity, agencyProductIntelligence, originatingWorklistItem] = await Promise.all([
    salesOpportunityId
      ? prisma.salesOpportunity.findFirst({ where: { id: salesOpportunityId, organizationId, wholesaleAccountId: selectedWholesaleAccountId ?? '__none__' }, select: { id: true, wholesaleAccountId: true } })
      : null,
    agencyProductIntelligenceId
      ? prisma.agencyProductIntelligence.findFirst({ where: { id: agencyProductIntelligenceId, organizationId, agencyId: agencyId ?? '__none__' }, select: { id: true, agencyId: true, inventoryState: true, itemCode: true, opportunityState: true } })
      : null,
    worklistItemId
      ? prisma.worklistItem.findFirst({ where: { id: worklistItemId, organizationId, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } }, select: { id: true, agencyId: true, wholesaleAccountId: true } })
      : null,
  ]);
  if ((salesOpportunityId && !salesOpportunity) || (agencyProductIntelligenceId && !agencyProductIntelligence) || (worklistItemId && !originatingWorklistItem)) {
    redirectVisitWithStatus(formOrigin, 'invalid-context', locationType);
  }
  if (originatingWorklistItem && ((originatingWorklistItem.agencyId && originatingWorklistItem.agencyId !== agencyId) || (originatingWorklistItem.wholesaleAccountId && originatingWorklistItem.wholesaleAccountId !== selectedWholesaleAccountId))) {
    redirectVisitWithStatus(formOrigin, 'invalid-context', locationType);
  }

  try {
    pendingPhotos = await Promise.all(
      pendingPhotos.map(async (photo) => {
        if (!photo.storageKey) return photo;
        if (!photo.url || !photoUploadSessionId) {
          throw new Error('Client-uploaded visit photo is missing its upload session.');
        }

        const verifiedPhoto = await verifyClientUploadedVisitPhoto({
          sessionId: photoUploadSessionId,
          storageKey: photo.storageKey,
          url: photo.url,
        });

        return { ...photo, ...verifiedPhoto };
      }),
    );
  } catch (error) {
    console.error('Visit photo verification failed', {
      error: getErrorLogDetails(error),
      formOrigin,
      locationType,
      userId: user.id,
    });
    redirectVisitWithStatus(formOrigin, 'photo-verification-failed', locationType);
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
              address: true,
              city: true,
              state: true,
              zip: true,
            },
          })
        : await tx.wholesaleAccount.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } },
            select: {
              id: true,
              licenseeId: true,
              licenseeIds: { select: { licenseeId: true } },
              address: true,
              city: true,
              state: true,
              zip: true,
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
        const nextAddress = {
          address: toOptional(formData.get('newWholesaleAddress')) ?? existingAccount.address,
          city: toOptional(formData.get('newWholesaleCity')) ?? existingAccount.city,
          state: existingAccount.state ?? 'OH',
          zip: toOptional(formData.get('newWholesaleZip')) ?? existingAccount.zip,
        };
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
            ...getGeocodeResetForAddressChange(existingAccount, nextAddress),
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
          organizationId,
          tagId,
          wholesaleAccountId,
          note: 'Applied during visit logging',
          createdByUserId: user.id,
        })),
        skipDuplicates: true,
      });
    }

    let contactId = isTaster ? null : toOptional(formData.get('contactId'));

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
          organizationId,
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
        organizationId,
        locationType,
        agencyId: locationType === 'agency' ? agencyId : null,
        wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
        salesOpportunityId: salesOpportunity?.id ?? null,
        agencyProductIntelligenceId: agencyProductIntelligence?.id ?? null,
        originatingWorklistItemId: originatingWorklistItem?.id ?? null,
        actionReturnTo: (() => { const value = toOptional(formData.get('returnTo')); return value?.startsWith('/') && !value.startsWith('//') ? value : null; })(),
        contactId,
        summary,
        outcomes,
        outcomeCodes,
        nextStep,
        followUpMode: requestedFollowUpMode,
        createdBy: actorName,
        createdByUserId: user.id,
        submissionKey,
        followUpDate,
        followUpTimeMinutes,
        followUpAssignedToUserId: followUpAssignee?.id ?? null,
      },
    });

    const taskCategory = locationType === 'agency' ? WorklistCategory.AGENCY : WorklistCategory.WHOLESALE;
    const taskLocation = {
      agencyId: locationType === 'agency' ? agencyId : null,
      wholesaleAccountId: locationType === 'wholesale' ? wholesaleAccountId : null,
    };
    const visitTaskDetail =
      [
        summary ? `Summary: ${summary}` : null,
        outcomes ? `Outcomes: ${outcomes}` : null,
        nextStep ? `Next step: ${nextStep}` : null,
      ]
        .filter(Boolean)
        .join('\n') || null;

    if (shouldCreateVisitTask(requestedFollowUpMode)) {
      await tx.worklistItem.create({
        data: {
          organizationId,
          title: nextStep ? `Follow up: ${nextStep.slice(0, 120)}` : 'Follow up on visit',
          detail: visitTaskDetail,
          status: WorklistStatus.OPEN,
          source: WorklistSource.VISIT_FOLLOW_UP,
          category: taskCategory,
          ...taskLocation,
          loggedVisitId: loggedVisit.id,
          dueDate: followUpDate,
          dueTimeMinutes: followUpTimeMinutes,
          assignedTo: followUpAssigneeName,
          assignedToUserId: followUpAssignee?.id ?? user.id,
          createdBy: actorName,
          createdByUserId: user.id,
        },
      });
    }

    for (const voiceFollowUp of selectedVoiceFollowUps) {
      await tx.worklistItem.create({
        data: {
          organizationId,
          title: voiceFollowUp.title,
          detail:
            [
              voiceFollowUp.description,
              voiceFollowUp.dueDateLabel && !voiceFollowUp.dueDate
                ? `Date heard from voice note: ${voiceFollowUp.dueDateLabel}`
                : null,
              visitTaskDetail,
            ]
              .filter(Boolean)
              .join('\n\n') || null,
          status: WorklistStatus.OPEN,
          source: WorklistSource.VISIT_FOLLOW_UP,
          category: taskCategory,
          ...taskLocation,
          loggedVisitId: loggedVisit.id,
          dueDate: voiceFollowUp.dueDate,
          assignedTo: followUpAssigneeName,
          assignedToUserId: followUpAssignee?.id ?? user.id,
          createdBy: actorName,
          createdByUserId: user.id,
        },
      });
    }

    if (worklistItemId) {
      await tx.worklistItem.update({
        where: { id: worklistItemId },
        data: {
          loggedVisitId: loggedVisit.id,
        },
      });
    }

    if (requestedWorklistCompletionIds.length > 0) {
      await tx.worklistItem.updateMany({
        where: {
          id: { in: requestedWorklistCompletionIds },
          status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
          OR: [{ assignedToUserId: user.id }, ...(worklistItemId ? [{ id: worklistItemId }] : [])],
          ...(locationType === 'agency'
            ? { agencyId, wholesaleAccountId: null }
            : { agencyId: null, wholesaleAccountId }),
        },
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

    if (salesOpportunity) {
      await tx.opportunityEvent.create({
        data: { organizationId, opportunityId: salesOpportunity.id, eventType: OpportunityEventType.VISIT_LOGGED, eventKey: `VISIT_LOGGED:${loggedVisit.id}`, wholesaleAccountId: salesOpportunity.wholesaleAccountId, userId: user.id, loggedVisitId: loggedVisit.id, metadata: { sourceType: toOptional(formData.get('sourceType')), productItemCode: toOptional(formData.get('productItemCode')), productName: toOptional(formData.get('productName')) }, occurredAt: new Date() },
      });
    }
    if (agencyProductIntelligence) {
      await tx.agencyIntelligenceEvent.create({
        data: { organizationId, agencyId: agencyProductIntelligence.agencyId, agencyProductIntelligenceId: agencyProductIntelligence.id, eventKey: `${agencyProductIntelligence.id}:VISIT_LOGGED:${loggedVisit.id}`, eventType: 'VISIT_LOGGED', inventoryState: agencyProductIntelligence.inventoryState, itemCode: agencyProductIntelligence.itemCode, opportunityState: agencyProductIntelligence.opportunityState, occurredAt: new Date(), snapshot: { actorUserId: user.id, loggedVisitId: loggedVisit.id } },
      });
    }

    return loggedVisit;
  });

  if (isTaster) {
    const photo = pendingPhotos[0]!;
    let uploadedPhoto: Awaited<ReturnType<typeof uploadVisitPhoto>> | null = null;

    try {
      uploadedPhoto = photo.file ? await uploadVisitPhoto(photo.file, visit.id, user.id, 0) : null;
      await prisma.visitPhoto.create({
        data: {
          organizationId,
          loggedVisitId: visit.id,
          type: PhotoType.OTHER,
          url: uploadedPhoto?.url ?? photo.url!,
          storageKey: uploadedPhoto?.storageKey ?? photo.storageKey,
          contentType: uploadedPhoto?.contentType ?? photo.contentType,
          sizeBytes: uploadedPhoto?.sizeBytes ?? photo.sizeBytes,
          caption: null,
          createdByUserId: user.id,
        },
      });
    } catch (error) {
      console.error('Taster visit photo persistence failed', {
        error: getErrorLogDetails(error),
        userId: user.id,
        visitId: visit.id,
      });
      await Promise.allSettled([
        deleteStoredPhoto(uploadedPhoto?.storageKey ?? photo.storageKey),
        prisma.loggedVisit.delete({ where: { id: visit.id } }),
      ]);
      redirectVisitWithStatus(formOrigin, 'photo-upload-failed', locationType);
    }
  } else if (pendingPhotos.length > 0) {
    try {
      const photos = await Promise.all(
        pendingPhotos.map(async (photo, index) => {
          if (photo.file) {
            const uploadedPhoto = await uploadVisitPhoto(photo.file, visit.id, user.id, index);

            return {
              organizationId,
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

          if (photo.storageKey) {
            return {
              organizationId,
              loggedVisitId: visit.id,
              type: photo.type,
              url: photo.url ?? '',
              storageKey: photo.storageKey,
              contentType: photo.contentType,
              sizeBytes: photo.sizeBytes,
              caption: photo.caption,
              createdByUserId: user.id,
            };
          }

          return {
            organizationId,
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
    } catch (error) {
      console.error('Visit photo persistence failed', {
        error: getErrorLogDetails(error),
        formOrigin,
        userId: user.id,
        visitId: visit.id,
      });
      redirectToVisitConfirmation(visit.id, formOrigin, 'photo-upload-failed');
    }
  }

  const calendarItems = await prisma.worklistItem.findMany({
    where: {
      OR: [
        { loggedVisitId: visit.id },
        ...(worklistItemId ? [{ id: worklistItemId }] : []),
        ...(requestedWorklistCompletionIds.length > 0
          ? [{
              id: { in: requestedWorklistCompletionIds },
              assignedToUserId: user.id,
              completedByUserId: user.id,
              loggedVisitId: visit.id,
            }]
          : []),
      ],
    },
    select: { id: true },
  });
  for (const item of calendarItems) await syncWorklistItemCalendar(item.id);
  if (visit.wholesaleAccountId) {
    if (await hasFeature(organizationId, 'WHOLESALE_OPPORTUNITIES')) await evaluateOpportunityIntelligence({ accountIds: [visit.wholesaleAccountId], organizationId });
  }

  revalidatePath('/visits');
  revalidatePath('/visits/new');
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  revalidatePath('/');
  revalidatePath('/agencies');
  revalidatePath('/wholesale');
  revalidatePath('/tags');
  if (visit.agencyId) {
    revalidatePath(`/agencies/${visit.agencyId}`);
  }
  if (visit.wholesaleAccountId) {
    revalidatePath(`/wholesale/${visit.wholesaleAccountId}`);
  }
  redirectToVisitConfirmation(visit.id, formOrigin);
}

export async function updateVisit(visitId: string, formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const actorName = getUserDisplayName(user);
  const existingVisit = await prisma.loggedVisit.findFirst({
    where: { id: visitId, organizationId },
    include: {
      worklistItems: {
        where: { source: WorklistSource.VISIT_FOLLOW_UP },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!existingVisit) redirect('/visits');

  const locationType = String(formData.get('locationType') ?? 'wholesale') === 'agency' ? 'agency' : 'wholesale';
  const agencyId = locationType === 'agency' ? toOptional(formData.get('agencyId')) : null;
  const wholesaleAccountId = locationType === 'wholesale' ? toOptional(formData.get('wholesaleAccountId')) : null;
  if (!agencyId && !wholesaleAccountId) redirect('/visits?status=invalid-location');

  const locationExists =
    locationType === 'agency'
      ? await prisma.agency.findUnique({ where: { id: agencyId! }, select: { id: true } })
      : await prisma.wholesaleAccount.findUnique({ where: { id: wholesaleAccountId! }, select: { id: true } });
  if (!locationExists) redirect('/visits?status=invalid-location');

  const contactId = toOptional(formData.get('contactId'));
  if (contactId) {
    const contact = await prisma.locationContact.findFirst({ where: { id: contactId, organizationId } });
    const agencyKeys = new Set([agencyId, locationType === 'agency' && agencyId ? (await prisma.agency.findUnique({ where: { id: agencyId }, select: { agencyId: true } }))?.agencyId : null].filter(Boolean));
    const contactMatches =
      contact &&
      (locationType === 'agency'
        ? Boolean(contact.agencyId && agencyKeys.has(contact.agencyId))
        : contact.wholesaleAccountId === wholesaleAccountId);
    if (!contactMatches) redirect('/visits?status=invalid-contact');
  }

  const outcomeCodes = sanitizeOutcomeCodes(locationType, getOutcomeCodes(formData));
  const outcomeLabels = getOutcomeLabels(locationType, outcomeCodes);
  const legacyOutcomes = toOptional(formData.get('outcomes'));
  const outcomes = outcomeLabels.length > 0 ? outcomeLabels.join(', ') : legacyOutcomes;
  const summary = toOptional(formData.get('summary'));
  const followUpMode = normalizeFollowUpMode(toOptional(formData.get('followUpMode')));
  const nextStep = followUpMode === 'none' ? null : toOptional(formData.get('nextStep'));
  const followUpDate = followUpMode === 'none' ? null : toDate(formData.get('followUpDate'));
  const followUpTimeMinutes = followUpDate ? parseTimeInputToMinutes(formData.get('followUpTime')) : null;
  const requestedFollowUpAssigneeId = followUpMode === 'task'
    ? toOptional(formData.get('followUpAssignedToUserId')) ?? user.id
    : null;
  const followUpAssignee = requestedFollowUpAssigneeId
    ? await prisma.user.findFirst({ where: { id: requestedFollowUpAssigneeId, organizationId, isActive: true, role: { notIn: [UserRole.TASTER, UserRole.PLATFORM_ADMIN] } } })
    : null;
  if (requestedFollowUpAssigneeId && !followUpAssignee) redirect('/visits?status=invalid-assignee');
  const followUpAssigneeName = followUpAssignee ? getUserDisplayName(followUpAssignee) : actorName;
  const taskCategory = locationType === 'agency' ? WorklistCategory.AGENCY : WorklistCategory.WHOLESALE;
  const primaryTask = existingVisit.worklistItems.find((item) => item.title.toLowerCase().startsWith('follow up'));
  const taskPlan = getVisitTaskEditPlan(followUpMode, primaryTask?.status);
  const taskTitle = nextStep ? `Follow up: ${nextStep.slice(0, 120)}` : 'Follow up on visit';
  const taskDetail = [summary ? `Visit notes: ${summary}` : null, outcomes ? `Outcomes: ${outcomes}` : null, nextStep ? `Next step: ${nextStep}` : null]
    .filter(Boolean)
    .join('\n') || null;

  await prisma.$transaction(async (tx) => {
    await tx.loggedVisit.update({
      where: { id: visitId },
      data: { locationType, agencyId, wholesaleAccountId, contactId, summary, outcomes, outcomeCodes, nextStep, followUpMode, followUpDate, followUpTimeMinutes, followUpAssignedToUserId: followUpAssignee?.id ?? null },
    });

    if (taskPlan === 'create' || taskPlan === 'update') {
      const taskData = {
        title: taskTitle,
        detail: taskDetail,
        status: WorklistStatus.OPEN,
        category: taskCategory,
        agencyId,
        wholesaleAccountId,
        dueDate: followUpDate,
        dueTimeMinutes: followUpTimeMinutes,
        assignedTo: followUpAssigneeName,
        assignedToUserId: followUpAssignee?.id ?? user.id,
        completedAt: null,
        completedByUserId: null,
        cancelledAt: null,
        cancelledByUserId: null,
      };
      if (taskPlan === 'update' && primaryTask) await tx.worklistItem.update({ where: { id: primaryTask.id }, data: taskData });
      else {
        await tx.worklistItem.create({
          data: {
            organizationId,
            ...taskData,
            source: WorklistSource.VISIT_FOLLOW_UP,
            loggedVisitId: visitId,
            createdBy: actorName,
            createdByUserId: user.id,
          },
        });
      }
    } else if (taskPlan === 'cancel' && primaryTask) {
      await tx.worklistItem.update({
        where: { id: primaryTask.id },
        data: { status: WorklistStatus.CANCELLED, cancelledAt: new Date(), cancelledByUserId: user.id },
      });
    }
  });

  const calendarTask = await prisma.worklistItem.findFirst({
    where: { loggedVisitId: visitId, source: WorklistSource.VISIT_FOLLOW_UP, title: { startsWith: 'Follow up', mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (calendarTask) await syncWorklistItemCalendar(calendarTask.id);
  if (existingVisit.wholesaleAccountId) {
    if (await hasFeature(organizationId, 'WHOLESALE_OPPORTUNITIES')) await evaluateOpportunityIntelligence({ accountIds: [existingVisit.wholesaleAccountId], organizationId });
  }

  revalidatePath('/visits');
  if (existingVisit.agencyId) revalidatePath(`/agencies/${existingVisit.agencyId}`);
  if (existingVisit.wholesaleAccountId) revalidatePath(`/wholesale/${existingVisit.wholesaleAccountId}`);
  if (agencyId) revalidatePath(`/agencies/${agencyId}`);
  if (wholesaleAccountId) revalidatePath(`/wholesale/${wholesaleAccountId}`);
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  redirect('/visits?status=updated');
}
