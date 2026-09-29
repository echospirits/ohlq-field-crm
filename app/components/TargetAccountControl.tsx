import { SalesAccountType } from '@prisma/client';
import { SubmitButton } from './SubmitButton';
import { updateAccountTargeting } from '../account-targeting/actions';

export function TargetAccountControl({ accountType, externalAccountId, isTargeting, returnTo, allowStop = false, compact = false }: {
  accountType: SalesAccountType;
  externalAccountId: string;
  isTargeting: boolean;
  returnTo: string;
  allowStop?: boolean;
  compact?: boolean;
}) {
  if (isTargeting && !allowStop) return null;
  return <form action={updateAccountTargeting} className={`target-account-control${compact ? ' compact' : ''}`}>
    <input name="accountType" type="hidden" value={accountType} />
    <input name="externalAccountId" type="hidden" value={externalAccountId} />
    <input name="isTargeting" type="hidden" value={String(!isTargeting)} />
    <input name="returnTo" type="hidden" value={returnTo} />
    <SubmitButton className={isTargeting ? 'secondary compact-btn' : 'secondary compact-btn'}>{isTargeting ? 'Stop Targeting' : 'Target Account'}</SubmitButton>
  </form>;
}
