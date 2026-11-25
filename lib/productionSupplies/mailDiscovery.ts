import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { productionMemberIds } from './config';
import { getWatchedSupplyMaterials } from './status';
import { isWatchedSupplyOrderRecord, watchedSupplyOrderWhere } from './watch';

export type SupplyMailDiscovery = {
  memberEmails: string[];
  materials: string[];
  orderReferences: string[];
  recentReplySubjects?: string[];
  recentReplyAnchorIds?: string[];
  recentShipmentReferences?: string[];
};
const quoted = (value: string) => '"'+value.replace(/["\\\r\n]/g,' ').trim().slice(0,100)+'"';
const suffix = (since: Date, includeSent: boolean) => ` after:${Math.floor(since.getTime()/1000)} -in:trash -in:spam${includeSent?'':' -in:sent'}`;
export function buildSupplyPriorityQueries(since: Date, includeSent: boolean, context: SupplyMailDiscovery) {
  const senders=context.memberEmails.filter(value=>/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(value)).slice(0,30).map(value=>'from:'+quoted(value));
  const buyer=senders.length?`({${senders.join(' ')}} (order OR reorder OR replenishment OR "please proceed" OR pallet OR bags))`:'(in:sent ("production order" OR "raw material" OR "replenishment"))';
  const materials=[...new Set([...context.materials,...context.orderReferences])].filter(value=>value.trim().length>2).sort().slice(0,40).map(quoted);
  return {
    DX5:`from:no-reply@fx5.com subject:"Inventory Low"${suffix(since,includeSent)}`,
    PRODUCTION_ORDERS:`(${buyer} OR (filename:pdf (proforma OR "order confirmation" OR "purchase order")))${suffix(since,includeSent)}`,
    MATERIALS:materials.length?`{${materials.join(' ')}}${suffix(since,includeSent)}`:null,
  };
}
export function buildSupplyIncrementalQuery(broadQuery: string, priorities: ReturnType<typeof buildSupplyPriorityQueries>) {
  return [broadQuery,...Object.values(priorities).filter((value):value is string=>Boolean(value))].map(query=>'('+query+')').join(' OR ');
}

export function supplyReplySubject(subject: string) {
  return subject.replace(/^(?:\s*re\s*:\s*)+/i, '').normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildSupplyRecentReplyQuery(since: Date, includeSent: boolean, subjects: string[], shipmentReferences?: string[]) {
  const clauses = subjects.map(subject => 'subject:' + quoted(subject));
  if (shipmentReferences) {
    clauses.push('subject:bol', 'filename:bol', 'filename:"bill of lading"', 'subject:"bill of lading"', 'subject:"proof of delivery"',
      '(has:attachment filename:pdf {"bill of lading" "proof of delivery"})');
    for (const reference of shipmentReferences) clauses.push(quoted(reference));
  }
  return '{' + clauses.join(' ') + '}' + suffix(since, includeSent);
}

export function matchesSupplyRecentFreight(subject: string, text: string, attachments: Array<{ filename?: string; mimeType?: string }>, references: ReadonlySet<string>) {
  if (references.size && [subject, text].some(value => value.split(/[^a-z0-9-]+/i).some(token => references.has(token.toLowerCase())))) return true;
  const namedFreight = [subject, ...attachments.map(part => part.filename || '')]
    .some(value => /(?:^|[^a-z0-9])(?:bol|bill[\s_-]+of[\s_-]+lading|proof[\s_-]+of[\s_-]+delivery)(?:[^a-z0-9]|$)/i.test(value));
  return namedFreight || attachments.some(part => part.mimeType === 'application/pdf') &&
    /\b(?:bill\s+of\s+lading|proof\s+of\s+delivery)\b/i.test(text);
}

async function watchedReplyDiscovery(organizationId: string, db: PrismaClient, watched: Awaited<ReturnType<typeof getWatchedSupplyMaterials>>, connectionId?: string, includeShipmentReferences?: boolean) {
  if (!watched.length) return { recentReplySubjects: [], recentReplyAnchorIds: [] };
  const orders = await db.supplyOrder.findMany({
    where: { ...watchedSupplyOrderWhere(organizationId, watched), status: { notIn: ['CANCELLED', 'RECEIVED'] }, historicalOutcomeUnknown: false },
    include: {
      lines: { where: { organizationId, ignored: false }, include: { allocations: { where: { organizationId }, select: { needId: true } } } },
      sources: {
        where: { source: { organizationId, provider: { in: ['GOOGLE', 'GOOGLE_CONNECTOR'] }, extractionStatus: 'COMPLETE', attachmentKey: '', subject: { not: null } } },
        orderBy: { source: { messageDate: 'desc' } },
        select: { source: { select: { subject: true, mailboxConnectionId: true, provider: true, messageId: true } } },
        take: 3,
      },
    },
    orderBy: [{ lastEvidenceAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'asc' }],
    take: 30,
  });
  const watchedOrders = orders.filter(order => isWatchedSupplyOrderRecord(order, watched));
  const sources = watchedOrders.flatMap(order => order.sources.map(link => link.source));
  const shipments = includeShipmentReferences && watchedOrders.length ? await db.supplyShipment.findMany({
    where: {
      organizationId, orderId: { in: watchedOrders.map(order => order.id) },
      referenceType: { in: ['BILL_OF_LADING', 'FREIGHT_PRO'] },
      OR: [{ providerMode: null }, { providerMode: { not: 'test' } }],
      status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] },
    },
    select: { reference: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: 20,
  }) : [];
  const subjects = sources.map(source => supplyReplySubject(source.subject ?? ''));
  const anchorIds = sources.filter(source => source.provider === 'GOOGLE' && source.mailboxConnectionId === connectionId).map(source => source.messageId);
  return {
    recentReplySubjects: [...new Set(subjects.filter(subject => subject.length >= 6 && subject.length <= 100))].slice(0, 20),
    recentReplyAnchorIds: [...new Set(anchorIds)],
    recentShipmentReferences: [...new Set(shipments.map(shipment => shipment.reference))].filter(reference => /^[A-Za-z0-9-]{5,40}$/.test(reference)),
  };
}

export async function supplyMailDiscovery(organizationId: string, preferences: unknown, db: PrismaClient, connectionId?: string, includeShipmentReferences?: boolean): Promise<SupplyMailDiscovery> {
  const [members,items,orders,watched]=await Promise.all([
    db.user.findMany({where:{organizationId,id:{in:productionMemberIds(preferences)},isActive:true},select:{email:true},take:30}),
    db.supplyCatalogItem.findMany({where:{organizationId,confirmed:true,departments:{hasSome:['PRODUCTION','SHARED']}},select:{name:true,aliases:{select:{alias:true}}},take:30,orderBy:{updatedAt:'desc'}}),
    db.supplyOrder.findMany({where:{organizationId,ignored:false,OR:[{lines:{some:{department:'PRODUCTION',ignored:false}}},{sources:{some:{source:{extractedFacts:{path:['productionConfirmation','purpose'],equals:'PRODUCTION_REPLENISHMENT'}}}}}]},select:{orderReference:true},take:30,orderBy:{updatedAt:'desc'}}),
    getWatchedSupplyMaterials(organizationId,db),
  ]);
  const replies = await watchedReplyDiscovery(organizationId, db, watched, connectionId, includeShipmentReferences);
  return {memberEmails:members.map(member=>member.email),materials:[...watched.flatMap(material=>[material.material,...material.aliases]),...items.flatMap(item=>[item.name,...item.aliases.map(alias=>alias.alias)])],orderReferences:orders.flatMap(order=>order.orderReference?[order.orderReference]:[]),...replies};
}

const scanInput=z.object({query:z.string(),pageToken:z.string().optional(),scanStarted:z.string().datetime(),messageIds:z.array(z.string()).max(20).optional(),messageIndex:z.number().int().nonnegative().optional(),nextPageToken:z.string().optional()});
export type SupplyMailScan=z.infer<typeof scanInput>;
export const SUPPLY_MAIL_LANES=['DX5','PRODUCTION_ORDERS','MATERIALS','BROAD'] as const;
export type SupplyMailLane=(typeof SUPPLY_MAIL_LANES)[number]|'INCREMENTAL';
const cursorInput=z.object({version:z.literal(2),scans:z.object({DX5:scanInput.nullable(),PRODUCTION_ORDERS:scanInput.nullable(),MATERIALS:scanInput.nullable(),BROAD:scanInput.nullable()}),completed:z.array(z.enum(SUPPLY_MAIL_LANES)),turn:z.number().int().nonnegative(),lastIncrementalAt:z.string().datetime(),incremental:scanInput.nullable(),fastRecentMail:z.boolean().optional(),lastRecentCheckAt:z.string().datetime().nullable().optional(),pendingRecentReplies:scanInput.nullable().optional(),historicalTurnDue:z.boolean().optional(),materialsSignature:z.string().optional(),pendingMaterials:z.object({signature:z.string(),scan:scanInput.nullable()}).nullable().optional()});
export type SupplyMailCursor=z.infer<typeof cursorInput>;
const materialSignature=(query:string|null)=>query?.replace(/\safter:\d+\b/g,'').trim() ?? '';
export function supplyMailCursor(raw: unknown, options:{now:Date;backfillComplete:boolean;lastSuccessfulSyncAt:Date|null;broadQuery:string;priorityQueries:ReturnType<typeof buildSupplyPriorityQueries>}):SupplyMailCursor {
  const parsed=cursorInput.safeParse(raw);
  if(parsed.success){
    const state=parsed.data,desired=materialSignature(options.priorityQueries.MATERIALS);
    state.materialsSignature ??= materialSignature(state.scans.MATERIALS?.query ?? null);
    if(desired===state.materialsSignature)state.pendingMaterials=null;
    if(desired!==state.materialsSignature && desired!==state.pendingMaterials?.signature){
      const replacement=options.priorityQueries.MATERIALS?{query:options.priorityQueries.MATERIALS,scanStarted:options.now.toISOString()}:null;
      const active=state.scans.MATERIALS;
      if(state.completed.includes('MATERIALS') || !active || !active.pageToken&&!active.messageIds){
        state.scans.MATERIALS=replacement;state.materialsSignature=desired;state.pendingMaterials=null;
        state.completed=state.completed.filter(lane=>lane!=='MATERIALS');if(!replacement)state.completed.push('MATERIALS');else state.turn=2;
      }else state.pendingMaterials={signature:desired,scan:replacement};
    }
    return state;
  }
  const legacy=scanInput.safeParse(raw);
  if(raw!==null && raw!==undefined && !legacy.success && !(typeof raw==='object' && Object.keys(raw).length===0))throw new Error('Mailbox checkpoint format is unsupported; retain it for review instead of restarting the scan.');
  const scan=(query:string):SupplyMailScan=>({query,scanStarted:options.now.toISOString()});
  return {version:2,scans:{DX5:scan(options.priorityQueries.DX5),PRODUCTION_ORDERS:scan(options.priorityQueries.PRODUCTION_ORDERS),MATERIALS:options.priorityQueries.MATERIALS?scan(options.priorityQueries.MATERIALS):null,BROAD:options.backfillComplete?null:legacy.success?legacy.data:scan(options.broadQuery)},completed:[...(options.priorityQueries.MATERIALS?[]:['MATERIALS' as const]),...(options.backfillComplete?['BROAD' as const]:[])],turn:0,lastIncrementalAt:(options.lastSuccessfulSyncAt??options.now).toISOString(),incremental:options.backfillComplete&&legacy.success?legacy.data:null,materialsSignature:materialSignature(options.priorityQueries.MATERIALS),pendingMaterials:null};
}
export function completeSupplyMailLane(state:SupplyMailCursor,lane:(typeof SUPPLY_MAIL_LANES)[number]) {
  if(lane==='MATERIALS'&&state.pendingMaterials){state.scans.MATERIALS=state.pendingMaterials.scan;state.materialsSignature=state.pendingMaterials.signature;state.pendingMaterials=null;if(state.scans.MATERIALS)return;}
  if(!state.completed.includes(lane))state.completed.push(lane);
}
export function chooseSupplyMailLane(cursor:SupplyMailCursor,now:Date,pollMinutes:number):SupplyMailLane|null {
  const incrementalDue = Boolean(cursor.incremental) || now.getTime() - Date.parse(cursor.lastIncrementalAt) >= pollMinutes * 60_000;
  if(incrementalDue && !cursor.historicalTurnDue)return 'INCREMENTAL';
  for(let offset=0;offset<SUPPLY_MAIL_LANES.length;offset++){const lane=SUPPLY_MAIL_LANES[(cursor.turn+offset)%SUPPLY_MAIL_LANES.length];if(!cursor.completed.includes(lane)&&cursor.scans[lane])return lane;}
  return incrementalDue ? 'INCREMENTAL' : null;
}
export const supplyHistoricalComplete=(cursor:SupplyMailCursor)=>SUPPLY_MAIL_LANES.every(lane=>cursor.completed.includes(lane));
