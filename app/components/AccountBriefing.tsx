import { prisma } from '../../lib/prisma';
import { getAccountBriefing } from '../../lib/crm/briefing';
import type { CrmAccount, CrmActor } from '../../lib/crm/activity';
import { AccountBriefingView } from './AccountBriefingView';

export async function AccountBriefing({ account, actor, lastPurchaseAt }: { account: CrmAccount; actor: CrmActor; lastPurchaseAt?: Date | null }) {
  const briefing = await getAccountBriefing(prisma, actor, account, new Date(), lastPurchaseAt ?? null);
  const action = briefing.indicators.nextAction === 'Review overdue Worklist commitments'
    ? <a className="btn secondary compact-btn" href="#account-worklist">Review work</a>
    : briefing.indicators.reasons.includes('No active contact recorded.')
    ? <a className="btn secondary compact-btn" href="#account-contact-editor">Add contact</a>
    : briefing.tasks.length ? <a className="btn secondary compact-btn" href="#account-worklist">Review work</a> : undefined;
  return <AccountBriefingView action={action} briefing={briefing} lastPurchaseAt={lastPurchaseAt} />;
}
