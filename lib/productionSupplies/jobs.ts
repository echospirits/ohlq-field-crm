import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { reconcileSupplyMailboxes, syncSupplyMailbox } from './mail';
import { refreshSupplyShipmentTracking } from './tracking';
import { getWatchedSupplyOrderScope, isWatchedSupplyOrderRecord } from './watch';
import { reconcileWatchedSupplyEvidence } from './service';
import { isSupplyReplayDue, SUPPLY_REPLAY_CHECKPOINT } from './replay';
import { SUPPLY_MAIL_LANES } from './mailDiscovery';

type JobServices = { reconcile?: typeof reconcileSupplyMailboxes; mailbox?: typeof syncSupplyMailbox; tracking?: typeof refreshSupplyShipmentTracking; watchScope?: typeof getWatchedSupplyOrderScope; replay?: typeof reconcileWatchedSupplyEvidence; clock?: () => number; organizationId?: string };
const mailboxEligibility = (ids:string[]):Prisma.SupplyMailboxSyncWhereInput => ({organizationId:{in:ids},connectionId:{not:null},status:{notIn:['PAUSED','CONNECTION_REQUIRED','PERMISSION_REQUIRED']}});
function mailboxBacklog(row:{status:string;backfillCompletedAt:Date|null;cursor:unknown}){
  const cursor=row.cursor as {version?:unknown;completed?:unknown;incremental?:unknown}|null;
  const completed=Array.isArray(cursor?.completed)?cursor.completed:[];
  const historicalPending=cursor?.version===2 && SUPPLY_MAIL_LANES.some(lane=>!completed.includes(lane));
  const backfillIncomplete=row.status==='INITIAL_IMPORT' || !row.backfillCompletedAt || historicalPending;
  return {backfillIncomplete,continuation:backfillIncomplete || row.status==='PROCESSING' || Boolean(cursor?.version===2 && cursor.incremental)};
}

/** Global due queues keep one long import from starving another person or tracking. */
export async function runSupplyJobs(db: PrismaClient = prisma, services: JobServices = {}) {
  const clock = services.clock ?? Date.now, started = clock();
  const reconcile = services.reconcile ?? reconcileSupplyMailboxes;
  const mailbox = services.mailbox ?? syncSupplyMailbox;
  const tracking = services.tracking ?? refreshSupplyShipmentTracking;
  const watchScope = services.watchScope ?? getWatchedSupplyOrderScope;
  const replay = services.replay ?? reconcileWatchedSupplyEvidence;
  const organizations = await db.organization.findMany({ where: { ...(services.organizationId ? { id: services.organizationId } : {}), active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, features: { some: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } }, select: { id: true }, take: 50, orderBy: { id: 'asc' } });
  const result = { organizations: 0, mailboxChecks: 0, mailboxErrors: 0, tracking: [] as Array<{ shipmentId: string; status: string }>, evidenceReplays: 0, replayErrors: 0, deferred: false, continuation: false, backfillIncomplete: false, earliestMailboxNextAt:null as string|null };
  // Metadata reconciliation performs no provider calls. Bound it separately from import work.
  for (const organization of organizations) {
    if (clock() - started > 20_000) { result.deferred = true; break; }
    try { await reconcile(organization.id, db); result.organizations++; } catch { result.mailboxErrors++; }
  }
  const ids = organizations.map(organization => organization.id);
  const scopes = await Promise.all(organizations.map(async organization => {
    try { return { organizationId: organization.id, ...await watchScope(organization.id, db) }; }
    catch { result.deferred = true; return { organizationId: organization.id, materials: [], orderWhere: { organizationId: organization.id } }; }
  }));
  const watchedOrders = scopes.filter(scope => scope.materials.length).map(scope => scope.orderWhere);
  const now = new Date(clock());
  const checkpoints = await db.supplyAudit.findMany({ where: { organizationId: { in: ids }, action: SUPPLY_REPLAY_CHECKPOINT }, distinct: ['organizationId'], orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { organizationId: true, createdAt: true, detail: true } }).catch(() => { result.replayErrors++; result.deferred = true; return []; });
  const replayQueue = scopes.filter(scope => scope.materials.length && isSupplyReplayDue(checkpoints.find(checkpoint => checkpoint.organizationId === scope.organizationId)?.detail, scope.materials, now)).sort((a, b) => (checkpoints.find(checkpoint => checkpoint.organizationId === a.organizationId)?.createdAt.getTime() ?? 0) - (checkpoints.find(checkpoint => checkpoint.organizationId === b.organizationId)?.createdAt.getTime() ?? 0));
  const [candidateShipments, dueMailboxes] = await Promise.all([
    watchedOrders.length ? db.supplyShipment.findMany({ where: { organizationId: { in: ids }, order: { OR: watchedOrders }, nextCheckAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }], take: 20, include: { order: { include: { lines: { where: { ignored: false }, include: { allocations: { select: { needId: true } } } } } } } }) : Promise.resolve([]),
    db.supplyMailboxSync.findMany({ where: { ...mailboxEligibility(ids), nextSyncAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ nextSyncAt: 'asc' }, { id: 'asc' }], take: 2, select: { organizationId: true, userId: true } }),
  ]);
  const dueShipments = candidateShipments.filter(shipment => isWatchedSupplyOrderRecord(shipment.order, scopes.find(scope => scope.organizationId === shipment.organizationId)?.materials ?? [])).slice(0, 2);
  // Start tracking first. Each lookup is bounded to two attempts with an 8s timeout.
  // Mail lanes each checkpoint by 120s and run concurrently, below the route's 300s limit.
  const trackingLane = (async () => {
    for (const shipment of dueShipments) {
      if (clock() - started > 220_000) { result.deferred = true; break; }
      try { const update = await tracking(shipment.organizationId, shipment.id, db, { timeoutMs: 8_000, maxAttempts: 2 }); result.tracking.push({ shipmentId: shipment.id, status: update.status }); }
      catch { result.tracking.push({ shipmentId: shipment.id, status: 'failed' }); }
    }
  })();
  const mailLanes = dueMailboxes.map(async row => {
    if (clock() - started > 100_000) { result.deferred = true; return; }
    try {
      const update = await mailbox(row.organizationId, row.userId, db, { budgetMs: 120_000 });
      result.mailboxChecks++;
      if ('error' in update) result.mailboxErrors++;
      if ('continuation' in update && update.continuation === true) result.continuation = true;
      if ('backfillIncomplete' in update && update.backfillIncomplete === true) result.backfillIncomplete = true;
    }
    catch { result.mailboxErrors++; }
  });
  const replayLanes = replayQueue.slice(0, 2).map(async scope => {
    try { const update = await replay(scope.organizationId, db, { maxSources: 20, budgetMs: 8_000, materials: scope.materials }); result.evidenceReplays++; result.replayErrors += update.errors; result.deferred ||= update.deferred; }
    catch { result.replayErrors++; result.deferred = true; }
  });
  await Promise.allSettled([trackingLane, ...mailLanes, ...replayLanes]);
  // Read persisted state after work: a regular tick can precede a mailbox's due
  // time, and an empty due queue must not erase its catch-up or incremental debt.
  try{
    const pending=await db.supplyMailboxSync.findMany({where:mailboxEligibility(ids),select:{nextSyncAt:true,leaseUntil:true,status:true,backfillCompletedAt:true,cursor:true},orderBy:[{nextSyncAt:'asc'},{id:'asc'}],take:5001});
    for(const row of pending){
      const backlog=mailboxBacklog(row);result.continuation ||= backlog.continuation;result.backfillIncomplete ||= backlog.backfillIncomplete;
      const next=Math.max(row.nextSyncAt.getTime(),row.leaseUntil?.getTime() || 0);
      if(!result.earliestMailboxNextAt || next<Date.parse(result.earliestMailboxNextAt))result.earliestMailboxNextAt=new Date(next).toISOString();
    }
    result.deferred ||= pending.length===5001;
  }catch{result.mailboxErrors++;result.deferred=true;}
  result.deferred ||= replayQueue.length > 2 || candidateShipments.length === 20 || dueShipments.length === 2 || dueMailboxes.length === 2 || organizations.length === 50;
  return result;
}
