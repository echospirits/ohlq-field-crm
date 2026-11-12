import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, type MailboxConnection, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { productionMemberIds, readSupplySettings } from './config';
import { decryptSupplyToken, encryptSupplyToken } from './mailCrypto';
import { extractSupplyMessage } from './extraction';
import { ingestEvidence } from './service';
import { isVerifiedDx5WarningSender } from './mailProvenance';
import { canReadSupplyMailbox, GMAIL_READ_SCOPE } from './mailAccess';
export { canReadSupplyMailbox, GMAIL_READ_SCOPE } from './mailAccess';

const GMAIL_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DISCOVERY = '(order OR invoice OR shipment OR shipping OR tracking OR freight OR backorder OR delivery OR confirmation OR receipt OR "low stock" OR "low inventory" OR "reorder" OR "Distillx5" OR "Five x 5")';
export function supplyOAuthRedirect(env: Record<string, string | undefined> = process.env) {
  const callbackPath = '/api/production-supplies/mail/google/callback';
  const value = env.SUPPLY_GOOGLE_REDIRECT_URI?.trim() || `${env.APP_BASE_URL?.replace(/\/+$/, '') || ''}${callbackPath}`;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Supply Gmail callback is not configured.'); }
  const localDevelopment = (env.APP_ENV || 'development') === 'development' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localDevelopment && url.protocol !== 'https:') || url.username || url.password || url.pathname !== callbackPath || url.search || url.hash) throw new Error('Supply Gmail callback must use the exact HTTPS callback path without credentials, query or fragment.');
  return url.toString();
}
const client = () => ({ id: process.env.SUPPLY_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID, secret: process.env.SUPPLY_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET });
export async function beginSupplyMailboxOAuth(organizationId: string, userId: string, db: PrismaClient = prisma) {
  if (process.env.SUPPLY_MAIL_INGESTION_ENABLED !== 'true' || (process.env.SUPPLY_MAIL_OAUTH_ENVIRONMENT || process.env.OAUTH_ENVIRONMENT) !== (process.env.APP_ENV || 'development')) throw new Error('Supply mailbox OAuth is not enabled for this environment.');
  const credentials = client();
  if (!credentials.id || !credentials.secret || !/^https?:\/\//.test(supplyOAuthRedirect())) throw new Error('Google mailbox OAuth is not configured.');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  await db.mailboxOAuthState.create({ data: { organizationId, userId, provider: 'SUPPLY_GOOGLE', stateHash: createHash('sha256').update(state).digest('hex'), verifierEncrypted: encryptSupplyToken(verifier), expiresAt: new Date(Date.now() + 600_000) } });
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: credentials.id, redirect_uri: supplyOAuthRedirect(), response_type: 'code', access_type: 'offline', prompt: 'consent', scope: `openid email ${GMAIL_READ_SCOPE}`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })}`;
}
export async function finishSupplyMailboxOAuth(organizationId: string, user: { id: string; email: string }, state: string, code: string, db: PrismaClient = prisma) {
  if (process.env.SUPPLY_MAIL_INGESTION_ENABLED !== 'true' || (process.env.SUPPLY_MAIL_OAUTH_ENVIRONMENT || process.env.OAUTH_ENVIRONMENT) !== (process.env.APP_ENV || 'development')) throw new Error('Supply mailbox OAuth is not enabled for this environment.');
  const hash = createHash('sha256').update(state).digest('hex');
  const saved = await db.mailboxOAuthState.findFirst({ where: { organizationId, userId: user.id, provider: 'SUPPLY_GOOGLE', stateHash: hash, expiresAt: { gt: new Date() } } });
  if (!saved) throw new Error('Mailbox authorization expired. Start again.');
  // Consume once before exchanging, including failed/cancelled exchanges.
  if (!(await db.mailboxOAuthState.deleteMany({ where: { id: saved.id } })).count) throw new Error('Mailbox authorization was already used.');
  const credentials = client();
  if (!credentials.id || !credentials.secret) throw new Error('Google mailbox OAuth is not configured.');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: credentials.id, client_secret: credentials.secret, redirect_uri: supplyOAuthRedirect(), grant_type: 'authorization_code', code, code_verifier: decryptSupplyToken(saved.verifierEncrypted) }) });
  if (!response.ok) throw new Error('Google mailbox authorization failed.');
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!token.access_token || !token.scope?.split(' ').includes(GMAIL_READ_SCOPE)) throw new Error('Read-only Gmail permission is required.');
  const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token.access_token}` } });
  if (!identityResponse.ok) throw new Error('Mailbox identity could not be verified.');
  const identity = await identityResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
  if (!identity.sub || !identity.email_verified || identity.email?.toLowerCase() !== user.email.toLowerCase()) throw new Error('Connect your own verified Neat email account.');
  const old = await db.mailboxConnection.findUnique({ where: { organizationId_userId_provider: { organizationId, userId: user.id, provider: 'GOOGLE' } } });
  if (!token.refresh_token && !old?.refreshTokenEncrypted?.startsWith('supply-v1.')) throw new Error('Offline Gmail access is required. Reconnect with consent.');
  await db.mailboxConnection.upsert({ where: { organizationId_userId_provider: { organizationId, userId: user.id, provider: 'GOOGLE' } }, create: { organizationId, userId: user.id, provider: 'GOOGLE', providerAccountId: identity.sub, email: identity.email!, accessTokenEncrypted: encryptSupplyToken(token.access_token), refreshTokenEncrypted: token.refresh_token ? encryptSupplyToken(token.refresh_token) : undefined, tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000), scope: token.scope }, update: { providerAccountId: identity.sub, email: identity.email!, accessTokenEncrypted: encryptSupplyToken(token.access_token), refreshTokenEncrypted: token.refresh_token ? encryptSupplyToken(token.refresh_token) : undefined, tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000), scope: token.scope, enabled: true, errorCode: null } });
  await reconcileSupplyMailboxes(organizationId, db);
}
export async function reconcileSupplyMailboxes(organizationId: string, db: PrismaClient = prisma) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { crmPreferences: true, active: true, accountStatus: true, features: { where: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } } });
  const memberIds = org.active && !['SUSPENDED','CANCELLED'].includes(org.accountStatus) && org.features.length ? productionMemberIds(org.crmPreferences) : [];
  const members = await db.user.findMany({ where: { id: { in: memberIds }, organizationId, isActive: true }, select: { id: true } });
  const activeIds = members.map(user => user.id);
  await db.supplyMailboxSync.updateMany({ where: { organizationId, userId: { notIn: activeIds } }, data: { status: 'PAUSED', leaseId: null, leaseUntil: null } });
  for (const member of members) {
    const connections = await db.mailboxConnection.findMany({ where: { organizationId, userId: member.id } });
    const connection = connections.find(canReadSupplyMailbox);
    const status = connection ? 'QUEUED' : connections.some(c => c.enabled) ? 'PERMISSION_REQUIRED' : 'CONNECTION_REQUIRED';
    const current = await db.supplyMailboxSync.findUnique({ where: { organizationId_userId: { organizationId, userId: member.id } } });
    const missingPermission = status === 'PERMISSION_REQUIRED' ? 'Reconnect your own Gmail mailbox with read permission for Production Supplies. Calendar consent and retired mailbox credentials do not provide a usable supply connection.' : null;
    await db.supplyMailboxSync.upsert({ where: { organizationId_userId: { organizationId, userId: member.id } }, create: { organizationId, userId: member.id, connectionId: connection?.id, status, errorMessage: missingPermission }, update: connection ? { connectionId: connection.id, ...(current?.status === 'PAUSED' || current?.connectionId !== connection.id ? { status, nextSyncAt: new Date(), cursor: Prisma.DbNull, backfillCompletedAt: null } : {}) } : { connectionId: null, status, errorCode: null, errorMessage: missingPermission, leaseId: null, leaseUntil: null } });
  }
  return activeIds;
}
async function tokenFor(connection: MailboxConnection, db: PrismaClient) {
  if (!connection.accessTokenEncrypted || !canReadSupplyMailbox(connection)) throw new Error('Gmail read permission required.');
  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60_000) return decryptSupplyToken(connection.accessTokenEncrypted);
  const credentials = client();
  if (!connection.refreshTokenEncrypted || !credentials.id || !credentials.secret) throw new Error('Reconnect Gmail to renew offline access.');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: credentials.id, client_secret: credentials.secret, grant_type: 'refresh_token', refresh_token: decryptSupplyToken(connection.refreshTokenEncrypted) }) });
  if (!response.ok) throw new Error(`Gmail token refresh failed (HTTP ${response.status}); reconnect if access was revoked.`);
  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error('Google did not return a mailbox access token.');
  await db.mailboxConnection.update({ where: { id: connection.id }, data: { accessTokenEncrypted: encryptSupplyToken(token.access_token), tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000) } });
  return token.access_token;
}
type GmailPart = { mimeType?: string; filename?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
export function flattenGmailParts(part: GmailPart): GmailPart[] { return [part, ...(part.parts ?? []).flatMap(flattenGmailParts)]; }
export function buildSupplyDiscoveryQuery(since: Date, includeSent: boolean) { return `${DISCOVERY} after:${Math.floor(since.getTime() / 1000)} -in:trash -in:spam${includeSent ? '' : ' -in:sent'}`; }
export class SupplyMailProviderError extends Error {
  constructor(message: string, readonly retryAt?: Date) { super(message); }
}
export async function gmailJson<T>(token: string, path: string, services: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  // Only code-composed paths and stored Gmail identifiers. Email-supplied URLs are never fetched.
  if (!path.startsWith('/messages') || /[\r\n]/.test(path)) throw new Error('Unsupported mailbox API path.');
  const fetchImpl = services.fetchImpl ?? fetch;
  const sleep = services.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await fetchImpl(`${GMAIL_ROOT}${path}`, { redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token}` } }); }
    catch { if (attempt < 2) { await sleep(500 * 2 ** attempt); continue; } throw new SupplyMailProviderError('Gmail synchronization could not reach the provider.'); }
    if (!response.ok) {
      const header = response.headers.get('retry-after');
      const retryAt = header ? /^\d+$/.test(header) ? new Date(Date.now() + Math.min(86400, Number(header)) * 1000) : new Date(header) : undefined;
      const validRetryAt = retryAt && Number.isFinite(retryAt.getTime()) ? retryAt : undefined;
      const delay = validRetryAt ? Math.max(0, validRetryAt.getTime() - Date.now()) : 500 * 2 ** attempt;
      if ([408, 429].includes(response.status) || response.status >= 500) {
        if (attempt < 2 && delay <= 10_000) { await sleep(delay); continue; }
        throw new SupplyMailProviderError(`Gmail synchronization temporarily failed (HTTP ${response.status}). Other mailboxes continue processing.`, validRetryAt);
      }
      throw new SupplyMailProviderError(`Gmail synchronization failed (HTTP ${response.status}); reconnect if read permission was revoked.`);
    }
    return await response.json() as T;
  }
  throw new SupplyMailProviderError('Gmail synchronization did not complete.');
}
async function stillMonitored(organizationId: string, userId: string, db: PrismaClient) {
  const org = await db.organization.findFirst({ where: { id: organizationId, active: true, accountStatus: { notIn: ['SUSPENDED','CANCELLED'] }, features: { some: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } }, select: { crmPreferences: true } });
  return Boolean(org && productionMemberIds(org.crmPreferences).includes(userId) && await db.user.findFirst({ where: { organizationId, id: userId, isActive: true }, select: { id: true } }));
}
const cursorInput = z.object({ query: z.string(), pageToken: z.string().optional(), scanStarted: z.string().datetime(), messageIds: z.array(z.string()).max(20).optional(), messageIndex: z.number().int().nonnegative().optional(), nextPageToken: z.string().optional() });
type MailServices = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; extract?: typeof extractSupplyMessage; ingest?: typeof ingestEvidence; now?: () => number; budgetMs?: number };
const terminalExtractions = ['COMPLETE', 'UNSUPPORTED', 'REVIEW'];
export function extractionRetry(attempt: number, now = new Date()) {
  return attempt >= 3 ? { extractionStatus: 'REVIEW', nextExtractionAt: null } : { extractionStatus: 'ERROR', nextExtractionAt: new Date(now.getTime() + 5 * 60_000 * 2 ** (attempt - 1)) };
}
export async function syncSupplyMailbox(organizationId: string, userId: string, db: PrismaClient = prisma, services: MailServices = {}) {
  if (process.env.SUPPLY_MAIL_INGESTION_ENABLED !== 'true') return { skipped: true, reason: 'environment-disabled' };
  if (!await stillMonitored(organizationId, userId, db)) return { skipped: true, reason: 'not-monitored' };
  const now = new Date(), leaseId = randomUUID();
  const claimed = await db.supplyMailboxSync.updateMany({ where: { organizationId, userId, connectionId: { not: null }, nextSyncAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseId, leaseUntil: new Date(now.getTime() + 240_000), status: 'PROCESSING' } });
  if (!claimed.count) return { skipped: true, reason: 'not-due-or-busy' };
  let processed = 0;
  const clock = services.now ?? Date.now, deadline = clock() + (services.budgetMs ?? 120_000);
  const extract = services.extract ?? extractSupplyMessage, ingest = services.ingest ?? ingestEvidence;
  try {
    const sync = await db.supplyMailboxSync.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId } } });
    const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { crmPreferences: true, timezone: true } });
    const settings = readSupplySettings(org.crmPreferences);
    const connection = await db.mailboxConnection.findFirst({ where: { id: sync.connectionId!, organizationId, userId, enabled: true } });
    if (!connection || !canReadSupplyMailbox(connection)) throw new Error('Gmail read permission required.');
    const token = await tokenFor(connection, db);
    const parsedCursor = cursorInput.safeParse(sync.cursor);
    const cursor = parsedCursor.success ? parsedCursor.data : null;
    const since = sync.backfillCompletedAt ? new Date((sync.lastSuccessfulSyncAt ?? now).getTime() - 48 * 3600_000) : new Date(now.getTime() - settings.historyDays * 86400_000);
    const query = cursor?.query || buildSupplyDiscoveryQuery(since, settings.includeSent);
    const scanStarted = cursor?.scanStarted || now.toISOString();
    if (!sync.backfillStartedAt) await db.supplyMailboxSync.update({ where: { id: sync.id }, data: { backfillStartedAt: now, status: 'INITIAL_IMPORT' } });
    const page = cursor?.messageIds ? { messages: cursor.messageIds.map(id => ({ id })), nextPageToken: cursor.nextPageToken }
      : await gmailJson<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(token, `/messages?${new URLSearchParams({ q: query, maxResults: '5', ...(cursor?.pageToken ? { pageToken: cursor.pageToken } : {}) })}`, services);
    const retrySources = cursor?.messageIds ? [] : await db.supplySource.findMany({ where: { organizationId, mailboxConnectionId: connection.id, extractionStatus: 'ERROR', nextExtractionAt: { lte: new Date() }, extractionAttemptCount: { lt: 3 } }, orderBy: { nextExtractionAt: 'asc' }, take: 2, select: { messageId: true } });
    const messageIds = [...new Set([...retrySources.map(source => source.messageId), ...(page.messages ?? []).map(message => message.id)])];
    let messageIndex = cursor?.messageIndex ?? 0;
    const checkpoint = () => ({ query, scanStarted, ...(cursor?.pageToken ? { pageToken: cursor.pageToken } : {}), messageIds, messageIndex, ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) });
    await db.supplyMailboxSync.updateMany({ where: { id: sync.id, leaseId }, data: { cursor: checkpoint() } });
    let deferred = false;
    for (; messageIndex < messageIds.length; messageIndex++) {
      if (clock() > deadline - 65_000) { deferred = true; break; }
      if (!await stillMonitored(organizationId, userId, db)) return { processed, skipped: true, reason: 'not-monitored' };
      const renewal = await db.supplyMailboxSync.updateMany({ where: { id: sync.id, leaseId, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 240_000), cursor: checkpoint() } });
      if (!renewal.count) return { processed, skipped: true, reason: 'lease-lost' };
      const messageId = messageIds[messageIndex];
      const message = await gmailJson<{ id: string; internalDate: string; payload: GmailPart }>(token, `/messages/${encodeURIComponent(messageId)}?format=full`, services);
      const parts = flattenGmailParts(message.payload);
      const subject = message.payload.headers?.find(h => h.name.toLowerCase() === 'subject')?.value?.slice(0, 300) ?? '';
      const text = parts.filter(p => p.mimeType === 'text/plain' && p.body?.data).map(p => Buffer.from(p.body!.data!, 'base64url').toString('utf8')).join('\n') || parts.filter(p => p.mimeType === 'text/html' && p.body?.data).map(p => Buffer.from(p.body!.data!, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ')).join('\n');
      const messageDate = new Date(Number(message.internalDate));
      if (!Number.isFinite(messageDate.getTime())) throw new Error('Gmail supplied an invalid source timestamp.');
      const historical = !sync.backfillCompletedAt && messageDate < new Date(scanStarted);
      const sources: Array<{ key: string; filename?: string; mimeType?: string; bytes?: Buffer; part?: GmailPart; unsupported?: boolean }> = [{ key: '' }];
      const attachments = parts.filter(p => p.filename);
      if (attachments.length > 10) sources.push({ key: '__attachment_limit__', filename: 'Additional attachments', unsupported: true });
      for (const part of attachments.slice(0, 10)) {
        const key = part.body?.attachmentId || part.filename!;
        if (!['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv'].includes(part.mimeType ?? '') || (part.body?.size ?? 0) > 8 * 1024 * 1024) { sources.push({ key, filename: part.filename, mimeType: part.mimeType, unsupported: true }); continue; }
        sources.push({ key, filename: part.filename, mimeType: part.mimeType, part });
      }
      for (const source of sources) {
        const existing = await db.supplySource.findFirst({ where: { organizationId, mailboxConnectionId: connection.id, messageId, attachmentKey: source.key } });
        if (existing && (terminalExtractions.includes(existing.extractionStatus) || existing.nextExtractionAt && existing.nextExtractionAt > new Date())) continue;
        if (clock() > deadline - 65_000) { deferred = true; break; }
        const sourceData = { mailboxConnectionId: connection.id, provider: 'GOOGLE', messageId, attachmentKey: source.key, messageDate: messageDate.toISOString(), contentHash: createHash('sha256').update(source.bytes ? new Uint8Array(source.bytes) : `${subject}\n${text}`).digest('hex'), filename: source.filename, mimeType: source.mimeType, subject, historical: existing?.historical ?? historical };
        if (source.unsupported) { await ingest({ organizationId, userId }, { source: { ...sourceData, extractionStatus: 'UNSUPPORTED', extractionError: 'Attachment type, size or count is unsupported. Review the original message.' } }, db); continue; }
        try {
          const renewed = await db.supplyMailboxSync.updateMany({ where: { id: sync.id, leaseId, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 240_000) } });
          if (!renewed.count) return { processed, skipped: true, reason: 'lease-lost' };
          if (source.part) {
            const data = source.part.body?.data || (source.part.body?.attachmentId ? (await gmailJson<{ data?: string }>(token, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(source.part.body.attachmentId)}`, services)).data : undefined);
            if (!data) throw new SupplyMailProviderError('The attachment is not available from Gmail.');
            source.bytes = Buffer.from(data, 'base64url');
            if (source.bytes.length > 8 * 1024 * 1024) { await ingest({ organizationId, userId }, { source: { ...sourceData, extractionStatus: 'UNSUPPORTED', extractionError: 'Attachment exceeds the 8 MiB extraction limit.' } }, db); continue; }
            sourceData.contentHash = createHash('sha256').update(new Uint8Array(source.bytes)).digest('hex');
          }
          let evidence = await extract({ subject, text, messageDate, timezone: org.timezone, ...(source.bytes ? { attachment: { filename: source.filename!, mimeType: source.mimeType!, bytes: source.bytes } } : {}) });
          if (evidence.kind === 'WARNING') evidence = { ...evidence, warningSource: isVerifiedDx5WarningSender(message.payload.headers ?? []) ? 'DISTILLX5_EMAIL' : 'OTHER_EMAIL' };
          if (!await stillMonitored(organizationId, userId, db)) return { processed, skipped: true, reason: 'not-monitored' };
          await ingest({ organizationId, userId }, { source: { ...sourceData, subject: evidence.kind === 'OTHER' ? undefined : subject, extractionStatus: 'COMPLETE' }, evidence }, db);
          await db.supplySource.updateMany({ where: { organizationId, mailboxConnectionId: connection.id, messageId, attachmentKey: source.key }, data: { extractionAttemptCount: { increment: 1 }, lastExtractionAt: new Date(), nextExtractionAt: null } });
          processed++;
        } catch (error) {
          if (!await stillMonitored(organizationId, userId, db)) return { processed, skipped: true, reason: 'not-monitored' };
          const retry = extractionRetry((existing?.extractionAttemptCount ?? 0) + 1);
          await ingest({ organizationId, userId }, { source: { ...sourceData, extractionStatus: retry.extractionStatus, extractionError: error instanceof SupplyMailProviderError ? error.message : 'Extraction could not produce validated supply facts. Retry or inspect the original source.' } }, db);
          await db.supplySource.updateMany({ where: { organizationId, mailboxConnectionId: connection.id, messageId, attachmentKey: source.key }, data: { ...retry, extractionAttemptCount: { increment: 1 }, lastExtractionAt: new Date() } });
        }
      }
      if (deferred) break;
    }
    const continuation = deferred || Boolean(page.nextPageToken);
    await db.supplyMailboxSync.updateMany({ where: { id: sync.id, leaseId }, data: { status: continuation ? !sync.backfillCompletedAt ? 'INITIAL_IMPORT' : 'PROCESSING' : 'CONNECTED', cursor: deferred ? checkpoint() : page.nextPageToken ? { query, pageToken: page.nextPageToken, scanStarted } : Prisma.DbNull, backfillCompletedAt: !continuation && !sync.backfillCompletedAt ? now : undefined, lastSuccessfulSyncAt: !continuation ? new Date(scanStarted) : undefined, nextSyncAt: new Date(Date.now() + (continuation ? 0 : settings.pollMinutes * 60_000)), processedCount: { increment: processed }, failureCount: 0, errorCode: null, errorMessage: null, leaseId: null, leaseUntil: null } });
    return { processed, continuation };
  } catch (error) {
    const sync = await db.supplyMailboxSync.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    const next = new Date(Date.now() + Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(8, sync?.failureCount ?? 0)));
    const nextSyncAt = error instanceof SupplyMailProviderError && error.retryAt && error.retryAt > next ? error.retryAt : next;
    await db.supplyMailboxSync.updateMany({ where: { organizationId, userId, leaseId }, data: { status: 'ERROR', errorCode: 'SYNC_FAILED', errorMessage: error instanceof SupplyMailProviderError ? error.message : 'Mailbox synchronization failed. Verify authorization and retry; other mailboxes continue.', failureCount: { increment: 1 }, nextSyncAt, leaseId: null, leaseUntil: null } });
    return { processed, error: true };
  }
}
