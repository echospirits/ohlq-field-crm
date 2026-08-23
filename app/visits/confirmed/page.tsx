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
import { resolveVisitOrigin } from './actions';
import { getVisitOriginResolution } from '../../../lib/visitOriginResolution';

export const metadata = buildPageMetadata('Visit Confirmed');

export default async function VisitConfirmedPage({
  searchParams,
}: {
  searchParams?: Promise<{
    origin?: string;
    status?: string;
    visitId?: string;
    resolved?: string;
  }>;
}) {
  const [params, user] = await Promise.all([(await searchParams) ?? {}, requireUser({ allowTaster: true })]);
  const visitId = String(params.visitId ?? '').trim();

  if (!visitId) {
    redirect(getSignedInHomePath(user.role));
  }

  const visit = await prisma.loggedVisit.findFirst({
    where: {
      id: visitId,
      createdByUserId: user.id,
    },
    select: {
      agencyId: true,
      locationType: true,
      wholesaleAccountId: true,
      actionReturnTo: true,
      salesOpportunity: { select: { title: true, status: true } },
      agencyProductIntelligence: { select: { itemName: true, opportunityState: true, status: true } },
      originatingWorklistItem: { select: { id: true, title: true, status: true } },
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
  const resolutionHandled = params.resolved === '1';
  const resolutionType = getVisitOriginResolution({ originatingTaskStatus: visit.originatingWorklistItem?.status, salesOpportunityStatus: visit.salesOpportunity?.status, agencyOpportunityStatus: visit.agencyProductIntelligence?.status });
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
            ? 'Your agency visit, comments, and picture were saved.'
            : `Your ${visit.locationType === 'wholesale' ? 'wholesale' : 'agency'} visit was saved.`}
      </p>
      {!resolutionHandled && resolutionType === 'task' ? <div className="visit-origin-resolution">
        <h2>Did this visit address the follow-up?</h2>
        <p>{visit.originatingWorklistItem?.title}</p>
        <div className="visit-confirmation-actions">
          <form action={resolveVisitOrigin}><input name="visitId" type="hidden" value={visitId} /><input name="origin" type="hidden" value={formOrigin} /><button name="decision" value="complete-task">Complete task</button><button className="secondary" name="decision" value="keep-open">Keep task open</button></form>
        </div>
      </div> : null}
      {!resolutionHandled && resolutionType === 'opportunity' ? <div className="visit-origin-resolution">
        <h2>Did this visit address the opportunity?</h2>
        <p>{visit.salesOpportunity?.title ?? `${visit.agencyProductIntelligence?.itemName} - ${visit.agencyProductIntelligence?.opportunityState.toLowerCase().replaceAll('_', ' ')}`}</p>
        <div className="visit-confirmation-actions">
          <form action={resolveVisitOrigin}><input name="visitId" type="hidden" value={visitId} /><input name="origin" type="hidden" value={formOrigin} /><button name="decision" value="action-opportunity">Mark actioned</button><button className="secondary" name="decision" value="keep-open">Keep open</button></form>
        </div>
      </div> : null}
      {resolutionHandled ? <p className="toast-notice">Your resolution choice was saved.</p> : null}
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
