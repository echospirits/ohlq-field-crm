import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { productionMemberIds } from './config';
import { getWatchedSupplyMaterials } from './status';

export type SupplyMailDiscovery = { memberEmails: string[]; materials: string[]; orderReferences: string[] };
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
export async function supplyMailDiscovery(organizationId: string, preferences: unknown, db: PrismaClient): Promise<SupplyMailDiscovery> {
  const [members,items,orders,watched]=await Promise.all([
    db.user.findMany({where:{organizationId,id:{in:productionMemberIds(preferences)},isActive:true},select:{email:true},take:30}),
    db.supplyCatalogItem.findMany({where:{organizationId,confirmed:true,departments:{hasSome:['PRODUCTION','SHARED']}},select:{name:true,aliases:{select:{alias:true}}},take:30,orderBy:{updatedAt:'desc'}}),
    db.supplyOrder.findMany({where:{organizationId,ignored:false,OR:[{lines:{some:{department:'PRODUCTION',ignored:false}}},{sources:{some:{source:{extractedFacts:{path:['productionConfirmation','purpose'],equals:'PRODUCTION_REPLENISHMENT'}}}}}]},select:{orderReference:true},take:30,orderBy:{updatedAt:'desc'}}),
    getWatchedSupplyMaterials(organizationId,db),
  ]);
  return {memberEmails:members.map(member=>member.email),materials:[...watched.flatMap(material=>[material.material,...material.aliases]),...items.flatMap(item=>[item.name,...item.aliases.map(alias=>alias.alias)])],orderReferences:orders.flatMap(order=>order.orderReference?[order.orderReference]:[])};
}

const scanInput=z.object({query:z.string(),pageToken:z.string().optional(),scanStarted:z.string().datetime(),messageIds:z.array(z.string()).max(20).optional(),messageIndex:z.number().int().nonnegative().optional(),nextPageToken:z.string().optional()});
export type SupplyMailScan=z.infer<typeof scanInput>;
export const SUPPLY_MAIL_LANES=['DX5','PRODUCTION_ORDERS','MATERIALS','BROAD'] as const;
export type SupplyMailLane=(typeof SUPPLY_MAIL_LANES)[number]|'INCREMENTAL';
const cursorInput=z.object({version:z.literal(2),scans:z.object({DX5:scanInput.nullable(),PRODUCTION_ORDERS:scanInput.nullable(),MATERIALS:scanInput.nullable(),BROAD:scanInput.nullable()}),completed:z.array(z.enum(SUPPLY_MAIL_LANES)),turn:z.number().int().nonnegative(),lastIncrementalAt:z.string().datetime(),incremental:scanInput.nullable(),materialsSignature:z.string().optional(),pendingMaterials:z.object({signature:z.string(),scan:scanInput.nullable()}).nullable().optional()});
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
  if(cursor.incremental || now.getTime()-new Date(cursor.lastIncrementalAt).getTime()>=pollMinutes*60_000)return 'INCREMENTAL';
  for(let offset=0;offset<SUPPLY_MAIL_LANES.length;offset++){const lane=SUPPLY_MAIL_LANES[(cursor.turn+offset)%SUPPLY_MAIL_LANES.length];if(!cursor.completed.includes(lane)&&cursor.scans[lane])return lane;}
  return null;
}
export const supplyHistoricalComplete=(cursor:SupplyMailCursor)=>SUPPLY_MAIL_LANES.every(lane=>cursor.completed.includes(lane));
