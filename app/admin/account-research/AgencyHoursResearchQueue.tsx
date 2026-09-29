'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ActionForm } from '../../components/ActionForm';
import { SubmitButton } from '../../components/SubmitButton';
import { researchAgencyOperatingHours } from '../../agencies/[id]/actions';

type AgencyHoursQueueItem = {
  id: string;
  agencyId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export function AgencyHoursResearchQueue({ agencies, researchAvailable }: {
  agencies: AgencyHoursQueueItem[];
  researchAvailable: boolean;
}) {
  const router = useRouter();

  if (agencies.length === 0) {
    return <div className="card empty-state"><h3>No Agencies need hours research</h3><p>Every Agency currently has known operating hours. Manually entered hours remain available to edit on the Agency account.</p></div>;
  }

  return <div className="card research-job-list agency-hours-research-queue">
    {agencies.map((agency) => {
      const hasCompleteAddress = Boolean(agency.address?.trim() && agency.city?.trim() && agency.state?.trim());
      return <div key={agency.id}>
        <span>
          <strong><Link href={`/agencies/${agency.id}#account-hours`}>{agency.name}</Link></strong>
          <small>Agency #{agency.agencyId} · {[agency.city, agency.state, agency.zip].filter(Boolean).join(', ') || 'Address incomplete'}</small>
          <small>{hasCompleteAddress ? 'Operating hours not recorded' : 'Needs a street address, city, and state before research'}</small>
        </span>
        <span>
          {hasCompleteAddress ? <ActionForm action={researchAgencyOperatingHours} className="agency-hours-queue-action" onSuccess={() => router.refresh()}>
            <input name="agencyId" type="hidden" value={agency.id} />
            <SubmitButton className="secondary" disabled={!researchAvailable} pendingLabel="Researching…">Research hours</SubmitButton>
          </ActionForm> : <Link className="btn secondary" href={`/agencies/${agency.id}#account-hours`}>Complete address</Link>}
        </span>
      </div>;
    })}
  </div>;
}
