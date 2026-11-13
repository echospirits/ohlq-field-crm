import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { hasSupplyAccess, readSupplySettings } from './config';
import { normalize } from './domain';
import type { SupplyActor } from './schemas';
import { buildSupplyStatusCard, normalizeSupplyLocation, normalizeSupplyMaterial, supplyMaterialSearchTerms, supplyStatusKey, type StatusOrder, type SupplyOrderHold, type WatchedSupplyMaterial } from './statusDomain';
export { matchWatchedSupplyLine, normalizeSupplyLocation, normalizeSupplyMaterial } from './statusDomain';
export type { SupplyStatusCard, WatchedSupplyMaterial } from './statusDomain';

type Db = PrismaClient | Prisma.TransactionClient;
// Future inventory adapters can join this seam without making Ollie a prerequisite.
export const INVENTORY_WARNING_SOURCES = ['DISTILLX5_EMAIL'] as const;
type Group = { material:WatchedSupplyMaterial; firstWarningAt:Date; latestWarningAt:Date; warningCount:number; reportedQuantity:unknown; reportedThreshold:unknown;locationWarningAt:Date|null };
async function watchedGroups(organizationId:string, db:Db):Promise<Group[]> {
  const dx5Source={AND:[{extractedFacts:{path:['kind'],equals:'WARNING'}},{extractedFacts:{path:['warningSource'],equals:'DISTILLX5_EMAIL'}}]} satisfies Prisma.SupplySourceWhereInput;
  const [needs, catalog] = await Promise.all([
    db.supplyNeed.findMany({ where:{organizationId,OR:[{warnings:{some:{organizationId,source:dx5Source}}},{audits:{some:{action:'CONFIRMED_PRODUCTION_ORDER_WATCH',order:{ignored:false}}}}]},include:{warnings:{where:{source:dx5Source},include:{source:{select:{extractedFacts:true}}},orderBy:{warningAt:'asc'}},audits:{where:{action:'CONFIRMED_PRODUCTION_ORDER_WATCH',order:{ignored:false}},select:{detail:true,createdAt:true,orderId:true}},allocations:{include:{line:{select:{description:true,sku:true,order:{select:{supplier:true,ignored:true}}}}}}},orderBy:[{createdAt:'asc'},{id:'asc'}] }),
    db.supplyCatalogItem.findMany({where:{organizationId},include:{aliases:true,rules:{where:{active:true}}}}),
  ]);
  const groups=new Map<string,Group>();
  for(const need of needs){
    const matches=catalog.filter(item=>item.id===need.catalogItemId || normalizeSupplyMaterial(item.name)===normalizeSupplyMaterial(need.description) || item.aliases.some(alias=>normalizeSupplyMaterial(alias.alias)===normalizeSupplyMaterial(need.description)));
    const item=need.catalogItemId?catalog.find(item=>item.id===need.catalogItemId):matches.length===1?matches[0]:undefined;
    const rawIds=need.warnings.flatMap(w=>{const facts=w.source.extractedFacts as {warning?:{materialId?:unknown}}|null;return typeof facts?.warning?.materialId==='string'?[facts.warning.materialId]:[];});
    const materialIdentity=item?`catalog:${item.id}`:`name:${normalizeSupplyMaterial(need.description)}`;
    const key=supplyStatusKey(materialIdentity,normalizeSupplyLocation(need.location));
    const warnings=need.warnings;
    const locationWarning=warnings.at(-1);
    const warningLocation=(locationWarning?.source.extractedFacts as {warning?:{location?:unknown}}|null)?.warning?.location;
    // A joined inventory alert does not acquire the purchase's physical destination.
    const location=typeof warningLocation==='string' && !normalizeSupplyLocation(warningLocation)?warningLocation:need.location;
    const confirmations=(need.audits || []).flatMap(audit=>{const detail=audit.detail as {triggerAt?:unknown;provenanceVersion?:unknown}|null;const at=typeof detail?.triggerAt==='string'?new Date(detail.triggerAt):null;return detail?.provenanceVersion===1 && at && Number.isFinite(at.getTime())?[at]:[];});
    const events=[...warnings.map(w=>w.warningAt),...confirmations].sort((a,b)=>a.getTime()-b.getTime());
    const first=events[0] || need.latestWarningAt || need.createdAt;
    const latest=events.at(-1) || need.latestWarningAt || need.createdAt;
    const watchSource:WatchedSupplyMaterial['watchSource']=confirmations.some(at=>at.getTime()===latest.getTime())?'PRODUCTION_ORDER':'DX5_ALERT';
    const allocations=(need.allocations || []).filter(allocation=>!allocation.line.order.ignored);
    const aliases=[need.description,...rawIds,...allocations.map(allocation=>allocation.line.description),...(item?[item.name,...item.aliases.map(alias=>alias.alias)]:[])];
    const vendorRefs=[...(item?[...item.aliases.filter(alias=>alias.supplier && alias.sku).map(alias=>({supplier:alias.supplier,sku:alias.sku})),...item.rules.map(rule=>({supplier:rule.supplier,sku:rule.sku}))]:[]),...allocations.flatMap(allocation=>allocation.line.sku?[{supplier:allocation.line.order.supplier,sku:allocation.line.sku}]:[])];
    const existing=groups.get(key);
    if(existing){
      existing.material.needIds.push(need.id); existing.material.aliases=[...new Set([...existing.material.aliases,...aliases])];
      existing.warningCount+=warnings.length; if(first<existing.firstWarningAt)existing.firstWarningAt=first;
      existing.material.vendorRefs=[...existing.material.vendorRefs,...vendorRefs];
      if(locationWarning && (!existing.locationWarningAt || locationWarning.warningAt>existing.locationWarningAt)){existing.locationWarningAt=locationWarning.warningAt;existing.material.location=location;}
      if(latest>existing.latestWarningAt){existing.latestWarningAt=latest;existing.material.latestWarningAt=latest;existing.material.watchSource=watchSource;existing.material.unit=need.unit;existing.reportedQuantity=warnings.at(-1)?.reportedQuantity ?? need.reportedQuantity;existing.reportedThreshold=warnings.at(-1)?.reportedThreshold ?? need.reportedThreshold;}
    }else groups.set(key,{material:{key,material:item?.name || need.description,location,unit:need.unit,catalogItemId:item?.id || null,aliases:[...new Set(aliases)],vendorRefs,needIds:[need.id],latestWarningAt:latest,sharedUse:item?.sharedUse || false,watchSource},firstWarningAt:first,latestWarningAt:latest,warningCount:warnings.length,reportedQuantity:warnings.at(-1)?.reportedQuantity ?? need.reportedQuantity,reportedThreshold:warnings.at(-1)?.reportedThreshold ?? need.reportedThreshold,locationWarningAt:locationWarning?.warningAt || null});
  }
  return [...groups.values()];
}
/** Includes dismissed warning/order cycles: their future delivery evidence is still needed. */
export async function getWatchedSupplyMaterials(organizationId:string,db:Db=prisma):Promise<WatchedSupplyMaterial[]>{return(await watchedGroups(organizationId,db)).map(group=>group.material);}
function dateBoundary(date:string,timezone:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const wanted=Date.parse(`${date}T00:00:00Z`);if(!Number.isFinite(wanted) || new Date(wanted).toISOString().slice(0,10)!==date)return null;
  try{let at=wanted;for(let i=0;i<2;i++){const p=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));const get=(key:string)=>p.find(part=>part.type===key)!.value;const wall=Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);at+=wanted-wall;}return new Date(at);}catch{return null;}
}
/** Payment gates and generic supplier promise dates are never arrival estimates. */
export function readSupplyOrderOperationalState(sources: Array<{messageDate:Date;extractedFacts:unknown}>): Pick<StatusOrder,'orderHold'|'supplierPromisedDate'|'paymentDueDate'> {
  const facts=[...sources].sort((a,b)=>b.messageDate.getTime()-a.messageDate.getTime()).flatMap(source=>{
    const value=source.extractedFacts as {kind?:unknown;orderHold?:unknown;supplierPromisedDate?:unknown;paymentDueDate?:unknown;_provenance?:{contentVersion?:unknown;evidenceContext?:unknown}}|null;
    return value && ['ORDER','SHIPMENT'].includes(String(value.kind)) && value._provenance?.contentVersion==='SUPPLY_CURRENT_V1' && value._provenance.evidenceContext!=='QUOTED_HISTORY'?[value]:[];
  });
  const hold=facts.find(value=>['PREPAYMENT_REQUIRED','PAYMENT_PENDING','OTHER','RELEASED'].includes(String(value.orderHold)))?.orderHold as SupplyOrderHold|undefined;
  const date=(key:'supplierPromisedDate'|'paymentDueDate')=>{const value=facts.find(fact=>typeof fact[key]==='string' && /^\d{4}-\d{2}-\d{2}$/.test(String(fact[key])))?.[key];return typeof value==='string'?value:null;};
  return {orderHold:hold || null,supplierPromisedDate:date('supplierPromisedDate'),paymentDueDate:date('paymentDueDate')};
}
async function dashboard(organizationId:string,db:Db){
  const organization=await db.organization.findFirst({where:{id:organizationId,active:true,accountStatus:{notIn:['SUSPENDED','CANCELLED']},features:{some:{featureKey:'PRODUCTION_SUPPLIES',enabled:true}}},select:{timezone:true}});
  if(!organization)throw new Error('Production Supplies is unavailable.');
  const groups=await watchedGroups(organizationId,db);if(!groups.length)return{cards:[],monitoredMaterials:0,lastAlertAt:null};
  const needIds=groups.flatMap(group=>group.material.needIds),catalogIds=groups.flatMap(group=>group.material.catalogItemId?[group.material.catalogItemId]:[]),names=[...new Set(groups.flatMap(group=>[group.material.material,...group.material.aliases]).flatMap(supplyMaterialSearchTerms))];
  const [orders,audits,users]=await Promise.all([
    db.supplyOrder.findMany({where:{organizationId,ignored:false,lines:{some:{organizationId,ignored:false,OR:[{catalogItemId:{in:catalogIds}},{allocations:{some:{organizationId,needId:{in:needIds}}}},...names.map(description=>({description:{contains:description,mode:Prisma.QueryMode.insensitive}})),...groups.flatMap(group=>group.material.vendorRefs).map(ref=>({sku:{equals:ref.sku,mode:Prisma.QueryMode.insensitive},order:{normalizedSupplier:normalize(ref.supplier)}}))]}}},include:{lines:true,shipments:{include:{lines:true,arrivalEstimates:true}},sources:{where:{source:{extractionStatus:{not:'IGNORED'}}},include:{source:{select:{extractedFacts:true,messageDate:true}}}}},orderBy:{updatedAt:'desc'},take:500}),
    db.supplyAudit.findMany({where:{organizationId,action:'SUPPLY_STATUS_DISMISSED',needId:{in:needIds}},select:{needId:true,detail:true,createdAt:true},orderBy:{createdAt:'desc'}}),
    db.user.findMany({where:{organizationId,isActive:true},select:{id:true,name:true,firstName:true,lastName:true}}),
  ]);
  const normalized:StatusOrder[]=orders.map(order=>({...order,...readSupplyOrderOperationalState(order.sources.map(link=>link.source)),ownerName:users.find(u=>u.id===order.ownerUserId)?.name || null,completeDeliveryEvidence:order.sources.flatMap(link=>{const facts=link.source.extractedFacts as {orderDeliveryComplete?:unknown;orderDeliveredDate?:unknown}|null;if(typeof facts?.orderDeliveryComplete!=='boolean')return[];const zone=order.shipments[0]?.timezone || organization.timezone;const at=typeof facts.orderDeliveredDate==='string'?dateBoundary(facts.orderDeliveredDate,zone):null;const next=typeof facts.orderDeliveredDate==='string' && at?new Date(Date.parse(`${facts.orderDeliveredDate}T12:00:00Z`)+86400000).toISOString().slice(0,10):null;const through=next?dateBoundary(next,zone) || undefined:undefined;return[{at,through,complete:facts.orderDeliveryComplete,observedAt:link.source.messageDate}];})}));
  const cards=groups.flatMap(group=>{
    const dismissals=audits.flatMap(audit=>{const detail=audit.detail as {cycleKey?:unknown}|null;return audit.needId && group.material.needIds.includes(audit.needId) && typeof detail?.cycleKey==='string'?[{cycleKey:detail.cycleKey,at:audit.createdAt}]:[];});
    const card=buildSupplyStatusCard(group.material,{...group,orders:normalized,dismissals});return card?[card]:[];
  }).sort((a,b)=>a.material.localeCompare(b.material)||a.location.localeCompare(b.location));
  return{cards,monitoredMaterials:groups.length,lastAlertAt:new Date(Math.max(...groups.map(group=>group.latestWarningAt.getTime()))).toISOString()};
}
export async function getSupplyStatusDashboard(organizationId:string,db:Db=prisma){return dashboard(organizationId,db);}
export async function dismissSupplyStatusCard(actor:SupplyActor,raw:unknown,db:PrismaClient=prisma){
  const input=z.object({needId:z.string().min(1).max(120),cycleKey:z.string().regex(/^[a-f0-9]{64}$/)}).parse(raw);
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supply:${actor.organizationId}`},0))`;
    const [user,organization]=await Promise.all([tx.user.findFirst({where:{id:actor.userId,organizationId:actor.organizationId,isActive:true},select:{id:true,role:true}}),tx.organization.findFirst({where:{id:actor.organizationId,active:true,accountStatus:{notIn:['SUSPENDED','CANCELLED']},features:{some:{featureKey:'PRODUCTION_SUPPLIES',enabled:true}}},select:{crmPreferences:true}})]);
    if(!user || !organization || !hasSupplyAccess(user,readSupplySettings(organization.crmPreferences),true)){const error=new Error('Production Supplies management access is required.');error.name='SupplyError';throw error;}
    const current=await dashboard(actor.organizationId,tx);
    const card=current.cards.find(card=>card.needId===input.needId && card.cycleKey===input.cycleKey);
    if(!card){const changed=current.cards.some(card=>card.needId===input.needId);const repeat=changed?null:await tx.supplyAudit.findFirst({where:{organizationId:actor.organizationId,needId:input.needId,action:'SUPPLY_STATUS_DISMISSED',detail:{path:['cycleKey'],equals:input.cycleKey}},select:{id:true}});if(repeat)return{dismissed:true};const error=new Error('This alert changed. Reload before dismissing its current cycle.');error.name='SupplyError';throw error;}
    await tx.supplyAudit.create({data:{organizationId:actor.organizationId,needId:card.needId,actorUserId:actor.userId,action:'SUPPLY_STATUS_DISMISSED',detail:{cycleKey:card.cycleKey,latestWarningAt:card.lastAlertAt,material:card.material,location:card.location}}});
    return{dismissed:true};
  },{timeout:30000});
}
