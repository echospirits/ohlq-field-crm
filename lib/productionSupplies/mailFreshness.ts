import { SUPPLY_FRESH_MAILBOX_LIMIT, SUPPLY_FRESH_MAIL_MS, SUPPLY_POLL_MINUTES } from './config';

type MailboxCoverage = {
  status: string;
  connectionId: string | null;
  lastSuccessfulSyncAt: Date | null;
  cursor: unknown;
};

const delayedStatuses = new Set(['CONNECTION_REQUIRED', 'PERMISSION_REQUIRED', 'ERROR']);
const hours = 60 * 60_000;

export function supplyEmailCoverage(mailboxes: MailboxCoverage[], pollMinutes: number, now: Date) {
  const monitored = mailboxes.filter(mailbox => mailbox.status !== 'PAUSED');
  const connected = monitored.filter(mailbox => mailbox.connectionId !== null);
  const connectionRequired = !monitored.length || monitored.some(mailbox =>
    !mailbox.connectionId || delayedStatuses.has(mailbox.status));
  // The worker checks at most two eligible mailboxes per six-hour run. Allow
  // a full rotation and one hour for job timing before flagging stale email.
  const rotationMinutes = Math.ceil(connected.length / 2) * SUPPLY_POLL_MINUTES;
  const overdueBefore = now.getTime() - Math.max(pollMinutes, rotationMinutes) * 60_000 - hours;
  const recentRotation = Math.ceil(connected.length / SUPPLY_FRESH_MAILBOX_LIMIT);
  const recentOverdueBefore = now.getTime() - (recentRotation + 1) * SUPPLY_FRESH_MAIL_MS;
  let oldestCheckAt: Date | null = null;
  let awaitingCheck = false;
  let stale = false;

  for (const mailbox of connected) {
    const cursor = mailbox.cursor as { lastRecentCheckAt?: unknown; fastRecentMail?: unknown } | null;
    const value = cursor?.lastRecentCheckAt;
    const checkedAt = value === undefined ? mailbox.lastSuccessfulSyncAt :
      typeof value === 'string' ? new Date(value) : null;
    if (!checkedAt || !Number.isFinite(checkedAt.getTime()) || checkedAt > now) {
      awaitingCheck = true;
      continue;
    }
    stale ||= checkedAt.getTime() < (cursor?.fastRecentMail === true ? recentOverdueBefore : overdueBefore);
    if (!oldestCheckAt || checkedAt < oldestCheckAt) oldestCheckAt = checkedAt;
  }

  return {
    stale,
    oldestCheckAt,
    awaitingCheck,
    connectionRequired,
    importing: monitored.some(mailbox => ['INITIAL_IMPORT', 'QUEUED'].includes(mailbox.status)),
  };
}
