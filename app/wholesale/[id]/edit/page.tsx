export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SubmitButton } from '../../../components/SubmitButton';
import { ActionForm } from '../../../components/ActionForm';
import { WholesaleAccountEditFields } from '../../../components/WholesaleAccountEditFields';
import { PageHeader } from '../../../components/PageChrome';
import { buildPageMetadata } from '../../../../lib/appBrand';
import { requireEchoAdmin } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { getWholesaleLicenseeIdValues } from '../../../../lib/wholesaleAccounts';
import { updateWholesaleAccount } from './actions';

export const metadata = buildPageMetadata('Edit Account');

const statusMessages: Record<string, string> = {
  invalid: 'Name and at least one Licensee ID are required.',
  'duplicate-licensee': 'Another restaurant account already uses one of those Licensee IDs.',
  'duplicate-official': 'That official account is already linked to another restaurant account.',
};

export default async function EditWholesaleAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireEchoAdmin();
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const account = await prisma.wholesaleAccount.findUnique({
    where: { id },
    include: {
      licenseeIds: {
        orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
        select: { licenseeId: true },
      },
    },
  });

  if (!account) {
    notFound();
  }
  if (account.mergedIntoId) {
    redirect(`/wholesale/${account.mergedIntoId}`);
  }

  return (
    <>
      <PageHeader
        actions={<Link className="btn secondary" href={`/wholesale/${account.id}`}>Back to account</Link>}
        description={account.name}
        eyebrow="Restaurant account"
        title="Edit account"
      />
      {query.status ? <p className="toast-notice page-status">{statusMessages[query.status] ?? query.status}</p> : null}

      <div className="workflow-shell"><div className="card admin-panel">
        <ActionForm action={updateWholesaleAccount}>
          <WholesaleAccountEditFields account={{
            id: account.id, name: account.name, licenseeIds: getWholesaleLicenseeIdValues(account),
            address: account.address, city: account.city, state: account.state, zip: account.zip,
            phone: account.phone, agencyId: account.agencyId, county: account.county,
            ownership: account.ownership, districtId: account.districtId, deliveryDay: account.deliveryDay,
            addressImportProtected: account.addressImportProtected,
            cityImportProtected: account.cityImportProtected,
            zipImportProtected: account.zipImportProtected,
          }} />
          <SubmitButton type="submit">Save restaurant account</SubmitButton>
        </ActionForm>
      </div></div>
    </>
  );
}
