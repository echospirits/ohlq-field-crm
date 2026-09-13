export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { isTasterRole } from '../../lib/userAccess';

export const metadata = buildPageMetadata('Accounts');

export default async function AccountsPage() {
  const user = await requireUser();
  if (isTasterRole(user.role)) redirect('/visits/new');
  redirect('/search');
}
