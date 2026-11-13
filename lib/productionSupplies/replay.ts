import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hasSupplyAccess, productionMemberIds, readSupplySettings } from './config';
import { fingerprint } from './domain';
import { canReadSupplyMailbox } from './mailAccess';
import type { SupplyActor } from './schemas';
import { getWatchedSupplyMaterials } from './status';
import { normalizeSupplyLocation, normalizeSupplyMaterial, type WatchedSupplyMaterial } from './statusDomain';
import { scopeSupplyEvidence, type WatchableSupplyEvidence } from './watch';
import { readSupplySourceProvenance } from './orderConfirmation';

export const SUPPLY_REPLAY_CHECKPOINT = 'SUPPLY_EVIDENCE_REPLAY_CHECKPOINT';
type ReplayIngest = (actor: SupplyActor, input: unknown, db: PrismaClient, options: { reconcile: false }) => Promise<{ orderId?: string }>;
export type ReplayOptions = { maxSources?: number; budgetMs?: number; now?: () => number; scope?: typeof scopeSupplyEvidence; materials?: WatchedSupplyMaterial[]; force?: boolean };
const checkpointInput = z.object({ version: z.literal(1), signature: z.string(), phase: z.enum(['ORDER', 'SHIPMENT']), after: z.object({ messageDate: z.string().datetime(), id: z.string() }).nullable(), complete: z.boolean(), nextReplayAt: z.string().datetime().nullable() });

/** Usage-alert times/counts are deliberately absent: they must never restart the scan. */
export function supplyWatchSignature(materials: WatchedSupplyMaterial[]) {
  return fingerprint(materials.map(material => ({ material: normalizeSupplyMaterial(material.material), location: normalizeSupplyLocation(material.location), catalogItemId: material.catalogItemId, sharedUse: material.sharedUse, aliases: [...new Set(material.aliases.map(normalizeSupplyMaterial))].sort(), vendorRefs: material.vendorRefs.map(reference => `${normalizeSupplyMaterial(reference.supplier)}:${reference.sku.trim().toLowerCase()}`).sort() })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function isSupplyReplayDue(detail: unknown, materials: WatchedSupplyMaterial[], now = new Date()) {
  const parsed = checkpointInput.safeParse(detail);
  return !parsed.success || parsed.data.signature !== supplyWatchSignature(materials) || !parsed.data.complete || !parsed.data.nextReplayAt || new Date(parsed.data.nextReplayAt) <= now;
}

/** Local retained evidence only. Never refetch mail, decrypt tokens or recursively replay. */
export async function replayWatchedSupplyEvidence(organizationId: string, db: PrismaClient, ingest: ReplayIngest, options: ReplayOptions = {}) {
  const result = { attempted: 0, linked: 0, errors: 0, deferred: false };
  const organization = await db.organization.findFirst({ where: { id: organizationId, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, features: { some: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } }, select: { crmPreferences: true } });
  if (!organization) return result;
  const materials = options.materials ?? await getWatchedSupplyMaterials(organizationId, db);
  if (!materials.length) return result;
  const settings = readSupplySettings(organization.crmPreferences), members = productionMemberIds(organization.crmPreferences);
  const now = options.now ?? Date.now, deadline = now() + Math.max(1, Math.min(15_000, options.budgetMs ?? 15_000));
  const limit = Math.max(1, Math.min(40, options.maxSources ?? 40)), signature = supplyWatchSignature(materials);
  const latest = await db.supplyAudit.findFirst({ where: { organizationId, action: SUPPLY_REPLAY_CHECKPOINT }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { detail: true } });
  const parsed = checkpointInput.safeParse(latest?.detail);
  if (!options.force && parsed.success && !isSupplyReplayDue(parsed.data, materials, new Date(now()))) return result;
  let state: z.infer<typeof checkpointInput> = parsed.success && parsed.data.signature === signature && !parsed.data.complete ? parsed.data : { version: 1, signature, phase: 'ORDER', after: null, complete: false, nextReplayAt: null };
  const scope = options.scope ?? scopeSupplyEvidence;
  let scanned = 0;
  for (let phase = 0; phase < 2 && scanned < limit && !state.complete; phase++) {
    if (now() >= deadline) break;
    const take = Math.min(20, limit - scanned), cursor = state.after;
    const sources = await db.supplySource.findMany({ where: { organizationId, extractionStatus: { in: ['COMPLETE', 'REVIEW'] }, orders: { none: {} }, extractedFacts: { path: ['kind'], equals: state.phase }, ...(cursor ? { OR: [{ messageDate: { lt: new Date(cursor.messageDate) } }, { messageDate: new Date(cursor.messageDate), id: { gt: cursor.id } }] } : {}) }, orderBy: [{ messageDate: 'desc' }, { id: 'asc' }], take });
    let finishedPage = true;
    for (const source of sources) {
      if (now() >= deadline) { finishedPage = false; break; }
      scanned++;
      state.after = { messageDate: source.messageDate.toISOString(), id: source.id };
      if (!source.userId || source.organizationId !== organizationId) continue;
      try {
        const user = await db.user.findFirst({ where: { organizationId, id: source.userId, isActive: true }, select: { id: true, role: true } });
        if (!user) continue;
        if (source.mailboxConnectionId) {
          if (!members.includes(user.id)) continue;
          const connection = await db.mailboxConnection.findFirst({ where: { organizationId, id: source.mailboxConnectionId, userId: user.id, enabled: true } });
          if (!connection || !canReadSupplyMailbox(connection)) continue;
        } else if (!hasSupplyAccess(user, settings, true)) continue;
        if (!(await scope(organizationId, source.extractedFacts as WatchableSupplyEvidence, db)).evidence) continue;
        result.attempted++;
        const {threadId,evidenceContext,contentVersion,direction,fromEmail,senderAuthenticated,attachmentPartId,attachmentMimePath,attachmentProviderId}=readSupplySourceProvenance(source.extractedFacts);
        const replayed = await ingest({ organizationId, userId: user.id }, { source: { threadId,evidenceContext,contentVersion,direction,fromEmail,senderAuthenticated,attachmentPartId,attachmentMimePath,attachmentProviderId,mailboxConnectionId: source.mailboxConnectionId, provider: source.provider, messageId: source.messageId, attachmentKey: source.attachmentKey, messageDate: source.messageDate.toISOString(), contentHash: source.contentHash, filename: source.filename, mimeType: source.mimeType, subject: source.subject, historical: source.historical, extractionStatus: 'COMPLETE' }, evidence: source.extractedFacts }, db, { reconcile: false });
        if (replayed.orderId) result.linked++;
      } catch { result.errors++; }
    }
    if (!finishedPage || sources.length === take) break;
    if (state.phase === 'ORDER') state = { ...state, phase: 'SHIPMENT', after: null };
    else state = { ...state, complete: true, nextReplayAt: new Date(now() + 15 * 60_000).toISOString() };
  }
  result.deferred = !state.complete;
  await db.supplyAudit.create({ data: { organizationId, action: SUPPLY_REPLAY_CHECKPOINT, detail: state as Prisma.InputJsonValue } });
  return result;
}
