export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { buildPageMetadata } from '../../../lib/appBrand';
import { accountExists, getAccountLocation } from '../../../lib/accountMemory';
import { requireUser } from '../../../lib/auth';
import { getIPhoneShortcutConfig, hashContactImportToken, validateContactImportSession } from '../../../lib/contactImport';
import { requireOrganizationContext } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';
import { ContactImportReviewForm } from './ContactImportReviewForm';

export const metadata = buildPageMetadata('Review Contact');

const InvalidImport = ({ returnTo = '/accounts' }: { returnTo?: string }) => <div className="workflow-shell"><div className="card admin-panel contact-import-error">
  <h2>This contact import is no longer valid</h2>
  <p>It may have expired, already been used, or belong to another user. No contact was saved.</p>
  <Link className="btn" href={returnTo}>Return to Neat</Link>
</div></div>;

export default async function ContactImportReviewPage({ searchParams }: { searchParams?: Promise<{ state?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const state = String((await searchParams)?.state ?? '');
  if (!state || state.length > 128) return <InvalidImport />;

  const session = await prisma.contactImportSession.findUnique({ where: { tokenHash: hashContactImportToken(state) } });
  if (!session) return <InvalidImport />;
  const location = getAccountLocation(session.accountType, session.accountId);
  if (!location || validateContactImportSession(session, { userId: user.id, organizationId, location }) !== 'valid') {
    return <InvalidImport returnTo={session.userId === user.id ? session.returnPath : '/accounts'} />;
  }
  if (!(await accountExists(prisma, location))) return <InvalidImport returnTo="/accounts" />;

  const config = getIPhoneShortcutConfig();
  return <>
    <PageHeader description="Confirm the selected Apple Contact before anything is saved." eyebrow="Contacts" title="Review Contact" />
    <div className="workflow-shell"><div className="card admin-panel">
      <ContactImportReviewForm
        accountId={session.accountId}
        accountType={location.accountType}
        installUrl={config.installUrl}
        requiredVersion={config.version}
        returnTo={session.returnPath}
        state={state}
      />
    </div></div>
  </>;
}
