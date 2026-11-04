export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../../lib/appBrand';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { getSignedInHomePath } from '../../../lib/userAccess';
import { getVisitContinueTarget, type VisitFormOrigin } from '../../../lib/visitConfirmation';
import { completeVisitRelatedWork } from './actions';
import { RelatedWorkPrompt } from './RelatedWorkPrompt';
import { getVisitRelatedWorkWhere } from '../../../lib/visitRelatedWork';
import { requireOrganizationContext } from '../../../lib/organizations';

export const metadata = buildPageMetadata('Visit Confirmed');

export default async function VisitConfirmedPage({
  searchParams,
}: {
  searchParams?: Promise<{
    origin?: string;
    status?: string;
    visitId?: string;
  }>;
}) {
  const [params, user] = await Promise.all([(await searchParams) ?? {}, requireUser({ allowTaster: true })]);
  const { organizationId } = await requireOrganizationContext(user);
  const visitId = String(params.visitId ?? '').trim();

  if (!visitId) {
    redirect(getSignedInHomePath(user.role));
  }

  const visit = await prisma.loggedVisit.findFirst({
    where: {
      id: visitId,
      organizationId,
      createdByUserId: user.id,
    },
    select: {
      id: true,
      agencyId: true,
      locationType: true,
      wholesaleAccountId: true,
      actionReturnTo: true,
      originatingWorklistItemId: true,
    },
  });

  if (!visit) {
    redirect(getSignedInHomePath(user.role));
  }

  const formOrigin: VisitFormOrigin = params.origin === 'worklist' ? 'worklist' : 'visits';
  const continueTarget = getVisitContinueTarget({
    formOrigin,
    isTaster: user.role === UserRole.TASTER,
    visit,
  });
  const photoUploadFailed = params.status === 'photo-upload-failed';
  const relatedWork = user.role === UserRole.TASTER ? [] : await prisma.worklistItem.findMany({
    where: getVisitRelatedWorkWhere(organizationId, user.id, visit),
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, detail: true, dueDate: true, assignedTo: true },
  });
  const returnTarget = visit.actionReturnTo ? { href: visit.actionReturnTo, label: 'Return to where you started' } : continueTarget;

  return (
    <section aria-live="polite" className="card visit-confirmation" role="status">
      <div aria-hidden="true" className="visit-confirmation-icon">
        ✓
      </div>
      <h1>Visit logged successfully</h1>
      <p>
        {photoUploadFailed
          ? 'The visit was saved, but one or more photos could not be uploaded.'
          : user.role === UserRole.TASTER
            ? 'Your retail visit, comments, and picture were saved.'
            : `Your ${visit.locationType === 'wholesale' ? 'wholesale' : 'agency'} visit was saved.`}
      </p>
      {relatedWork.length > 0 ? <RelatedWorkPrompt
        visitId={visit.id}
        initialItems={relatedWork.map((item) => ({ ...item, dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null }))}
        completeAction={completeVisitRelatedWork}
      /> : null}
      <div className="visit-confirmation-actions">
        <Link className="btn" href={returnTarget.href}>
          {returnTarget.label}
        </Link>
        {user.role !== UserRole.TASTER ? (
          <Link className="btn secondary" href="/visits/new">
            Log another visit
          </Link>
        ) : null}
      </div>
    </section>
  );
}
