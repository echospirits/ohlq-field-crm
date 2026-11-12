import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserDisplayName } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { isAdminRole } from '../../../lib/userAccess';
import { readAccountConfiguration } from '../../../lib/crm/accountConfiguration';
import { requireSupplyMailboxOwner } from '../../../lib/productionSupplies/access';
import { hasSupplyAccess, productionMemberIds, readSupplySettings } from '../../../lib/productionSupplies/config';
import { canReadSupplyMailbox } from '../../../lib/productionSupplies/mail';
import { getTrackingConfiguration } from '../../../lib/productionSupplies/tracking';
import { PageHeader, SectionHeading } from '../../components/PageChrome';
import { ProductionTeamFields } from './ProductionTeamFields';
import { SubmitButton } from '../../components/SubmitButton';
import { disconnectSupplyMailbox, queueSupplyMailbox, saveSupplySettings } from './actions';
import '../supplies.css';
export const dynamic = 'force-dynamic';
export const metadata = buildPageMetadata('Production Supplies settings');
const labels: Record<string,string> = { CONNECTED: 'Connected and processing', PROCESSING: 'Processing', INITIAL_IMPORT: 'Initial import running', QUEUED: 'Initial import queued', CONNECTION_REQUIRED: 'Connection required', PERMISSION_REQUIRED: 'Gmail read permission required', ERROR: 'Synchronization error', PAUSED: 'Monitoring paused' };

export default async function SupplySettingsPage({ searchParams }: { searchParams: Promise<Record<string,string | undefined>> }) {
  const { user, context } = await requireSupplyMailboxOwner();
  const preferences = context.organization.crmPreferences, config = readAccountConfiguration(preferences), settings = readSupplySettings(preferences), members = productionMemberIds(preferences);
  const admin = isAdminRole(user.role), canView = hasSupplyAccess(user, settings);
  if (!canView && !members.includes(user.id)) notFound();
  const users = await prisma.user.findMany({ where: { organizationId: context.organizationId, isActive: true, role: { not: 'PLATFORM_ADMIN' }, ...(canView ? {} : { id: user.id }) }, select: { id: true, name: true, firstName: true, lastName: true, email: true }, orderBy: { name: 'asc' } });
  const connections = await prisma.mailboxConnection.findMany({ where: { organizationId: context.organizationId, ...(canView ? { userId: { in: members } } : { userId: user.id }) }, select: { id: true, userId: true, provider: true, enabled: true, scope: true, accessTokenEncrypted: true } });
  const syncs = await prisma.supplyMailboxSync.findMany({ where: { organizationId: context.organizationId, ...(canView ? { userId: { in: members } } : { userId: user.id }) } });
  const ownConnected = connections.some(c => c.userId === user.id && canReadSupplyMailbox(c));
  const query = await searchParams;
  const messages: Record<string,string> = { saved: 'Production team and access saved. Authorized mailboxes are queued.', connected: 'Your Gmail mailbox is connected. Production monitoring is queued when you belong to the Production team.', disconnected: 'Your mailbox is disconnected. Shared supply records are retained.', queued: 'Your mailbox is queued for the next background run.', 'oauth-not-configured': 'Gmail setup is incomplete. An administrator must enable mailbox ingestion, configure Google OAuth and the encryption key, and register this environment’s callback URL.', 'connection-failed': 'Gmail connection failed. Use your own verified Neat email and grant read-only Gmail access, then reconnect.', 'invalid-settings': 'Choose valid team members and access permissions, 1–365 import days and 15–1440 polling minutes.', 'save-failed': 'Settings could not be saved. Reload to use the current team and active user list, then try again.' };
  const tracking = getTrackingConfiguration();
  return <div className="supply-workspace">
    <PageHeader title="Production Supplies settings" actions={canView ? <Link className="btn secondary" href="/production-supplies">Back to supplies</Link> : undefined} />
    {query.status && messages[query.status] ? <p role="status" className="notice">{messages[query.status]}</p> : null}
    <section><SectionHeading title="Mailbox monitoring" />
      {members.length ? <ul className="supply-settings-people">{users.filter(person => members.includes(person.id)).map(person => { const sync = syncs.find(s => s.userId === person.id), connection = connections.find(c => c.userId === person.id && canReadSupplyMailbox(c)); return <li key={person.id}><strong>{getUserDisplayName(person)}</strong><span>{labels[sync?.status ?? (connection ? 'QUEUED' : 'CONNECTION_REQUIRED')] ?? 'Needs attention'}</span><span className="muted">{sync?.lastSuccessfulSyncAt ? `Last sync ${sync.lastSuccessfulSyncAt.toLocaleString('en-US', { timeZone: context.organization.timezone })}` : 'No successful synchronization yet'}{sync?.processedCount ? ` · ${sync.processedCount} sources processed` : ''}</span>{sync?.errorMessage ? <span className="error">{sync.errorMessage}</span> : null}{person.id === user.id && !connection ? <Link href="/api/production-supplies/mail/google/connect">Connect my Gmail</Link> : null}</li>; })}</ul> : <p className="muted">Choose the production team below to start monitoring. Each person connects their own mailbox.</p>}
      <div className="supply-inline-actions">{ownConnected ? <><form action={queueSupplyMailbox}><SubmitButton pendingLabel="Queuing…">Check my mailbox</SubmitButton></form><form action={disconnectSupplyMailbox}><SubmitButton className="secondary" pendingLabel="Disconnecting…">Disconnect my mailbox</SubmitButton></form></> : <Link className="btn" href="/api/production-supplies/mail/google/connect">Connect my Gmail</Link>}</div>
      <p className="field-note">Read-only Gmail access covers relevant received and authorized sent messages. Calendar access does not grant mailbox access. A missing connection does not stop other team members.</p>
      {process.env.SUPPLY_MAIL_INGESTION_ENABLED !== 'true' ? <p className="notice">Mailbox processing is disabled in this environment.</p> : null}
    </section>
    {admin ? <form action={saveSupplySettings} className="supply-settings-form">
      <input type="hidden" name="version" value={config.version} />
      <SectionHeading title="Production membership and access" />
      <ProductionTeamFields teams={config.teams} users={users.map(person => ({ id: person.id, label: getUserDisplayName(person) }))} initialTeamId={settings.productionTeamId} viewerUserIds={settings.viewerUserIds} managerUserIds={settings.managerUserIds} />
      <SectionHeading title="Background processing" />
      <div className="form-grid"><label>Historical import (days)<input name="historyDays" type="number" min="1" max="365" defaultValue={settings.historyDays} required /></label><label>Mailbox polling (minutes)<input name="pollMinutes" type="number" min="15" max="1440" defaultValue={settings.pollMinutes} required /></label></div>
      <label><input type="checkbox" name="includeSent" defaultChecked={settings.includeSent} />Include relevant sent-message context</label>
      <SubmitButton pendingLabel="Saving…">Save production settings</SubmitButton>
    </form> : null}
    <section><SectionHeading title="Shipment tracking" /><p>{tracking.configured ? tracking.mode === 'live' ? 'Live EasyPost tracking configured' : 'EasyPost test mode — simulated carrier data' : 'Tracking connection required'}</p>{tracking.reason ? <p className="notice">{tracking.reason}</p> : null}<p className="field-note">Supported parcel references refresh in the background. Freight and supplier-operated delivery references remain visible with their specific automation limitation. GFS delivery automation requires a supported supplier integration.</p></section>
  </div>;
}
