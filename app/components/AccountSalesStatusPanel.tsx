import { SalesAccountType, type AccountSalesStatus } from '@prisma/client';
import { getUserDisplayName } from '../../lib/auth';
import { BUYING_STATE_LABELS, SALES_STATUS_LABELS, SALES_STATUS_OPTIONS, type BuyingState } from '../../lib/accountSalesStatus';
import { formatEasternDate } from '../../lib/dateTime';
import { updateAccountSalesStatus } from '../account-sales-status/actions';
import { SubmitButton } from './SubmitButton';
import { SalesStatusJourney } from './SalesStatusJourney';

const DAY = 86_400_000;
const timeInStatus = (updatedAt: Date | null) => {
  if (!updatedAt) return 'Not updated yet';
  const days = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / DAY));
  if (days === 0) return 'Updated today';
  return `${days} day${days === 1 ? '' : 's'} in status`;
};

export function AccountSalesStatusPanel({
  accountType,
  compact = false,
  buyingState,
  changedBy,
  externalAccountId,
  returnTo,
  status,
  statusIsExplicit,
  statusUpdatedAt,
}: {
  accountType: SalesAccountType;
  compact?: boolean;
  buyingState: BuyingState;
  changedBy: { email: string; name: string | null; firstName: string | null; lastName: string | null } | null;
  externalAccountId: string;
  returnTo: string;
  status: AccountSalesStatus;
  statusIsExplicit: boolean;
  statusUpdatedAt: Date | null;
}) {
  return <section className={`account-sales-status-section${compact ? ' account-sales-status-section--compact' : ''}`} aria-label="Account sales status">
    <SalesStatusJourney currentStatus={status} compact={compact} />
    <div className="account-sales-status-bar">
    <div className="account-sales-status-current">
      <span><small>Sales Status</small><strong>{SALES_STATUS_LABELS[status]}</strong></span>
      <span><small>Buying State</small><strong>{BUYING_STATE_LABELS[buyingState]}</strong></span>
      <span className="account-sales-status-meta"><small>{timeInStatus(statusUpdatedAt)}</small>{statusUpdatedAt ? <span>{formatEasternDate(statusUpdatedAt)}{changedBy ? ` · ${getUserDisplayName(changedBy)}` : ''}</span> : <span>{statusIsExplicit ? 'Saved status' : 'Default pilot status'}</span>}</span>
    </div>
    <form action={updateAccountSalesStatus} className="account-sales-status-form">
      <input name="accountType" type="hidden" value={accountType} />
      <input name="externalAccountId" type="hidden" value={externalAccountId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <label htmlFor={`sales-status-${accountType}-${externalAccountId}`}>Change status</label>
      <select defaultValue={status} id={`sales-status-${accountType}-${externalAccountId}`} name="salesStatus">
        {SALES_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <SubmitButton className="compact-btn" pendingLabel="Saving…">Save</SubmitButton>
    </form>
    </div>
  </section>;
}
