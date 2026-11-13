import type { Prisma } from '@prisma/client';
import { fingerprint, normalize } from './domain';
import { normalizeSupplyLocation,normalizeSupplyMaterial,supplyMaterialSearchTerms } from './statusDomain';
import { productionMemberIds } from './config';
import type { ValidatedSupplyEvidence, ValidatedSupplySource } from './service';

export type SupplySourceProvenance = Pick<ValidatedSupplySource, 'threadId'|'evidenceContext'|'contentVersion'|'direction'|'fromEmail'|'senderAuthenticated'|'attachmentPartId'|'attachmentMimePath'|'attachmentProviderId'> & { productionTeamAuthorized?: boolean; confirmationValidated?: boolean; correlatedSourceIds?: string[] };
export function readSupplySourceProvenance(value: unknown): SupplySourceProvenance {
  const raw = (value as { _provenance?: SupplySourceProvenance } | null)?._provenance;
  return raw && typeof raw === 'object' ? raw : {};
}
export function isCurrentSupplyEvidence(provenance: SupplySourceProvenance) {
  return provenance.contentVersion === 'SUPPLY_CURRENT_V1' && ['CURRENT_MESSAGE','ATTACHMENT','VERIFIED_BOOTSTRAP'].includes(provenance.evidenceContext || '');
}
/** Keep the first observed download handle as provenance, even across evidence-less retries. */
export function mergeSupplySourceProvenance(previousFacts:unknown,incoming:SupplySourceProvenance):SupplySourceProvenance {
  const previous=readSupplySourceProvenance(previousFacts);
  return {threadId:incoming.threadId ?? previous.threadId,evidenceContext:incoming.evidenceContext ?? previous.evidenceContext,contentVersion:incoming.contentVersion ?? previous.contentVersion,direction:incoming.direction ?? previous.direction,fromEmail:incoming.fromEmail ?? previous.fromEmail,senderAuthenticated:incoming.senderAuthenticated ?? previous.senderAuthenticated,attachmentPartId:previous.attachmentPartId ?? incoming.attachmentPartId,attachmentMimePath:previous.attachmentMimePath ?? incoming.attachmentMimePath,attachmentProviderId:previous.attachmentProviderId ?? incoming.attachmentProviderId,productionTeamAuthorized:incoming.productionTeamAuthorized};
}
function compatible(a: ValidatedSupplyEvidence, b: ValidatedSupplyEvidence) {
  if (a.orderReference && b.orderReference && a.orderReference.trim()!==b.orderReference.trim()) return false;
  if (normalize(a.supplier) && normalize(b.supplier) && normalize(a.supplier)!==normalize(b.supplier)) return false;
  const locationA=normalizeSupplyLocation(a.destination),locationB=normalizeSupplyLocation(b.destination);
  if(locationA && locationB && locationA!==locationB)return false;
  // Different raw units are never equated or converted. Conflicting known supplier IDs cannot identify one item.
  if(a.lines.length===1 && b.lines.length===1 && a.lines[0].sku && b.lines[0].sku && normalize(a.lines[0].sku)!==normalize(b.lines[0].sku))return false;
  if(a.lines.length && b.lines.length && !a.lines.every(line=>b.lines.some(other=>{
    if(line.sku && other.sku)return normalize(line.sku)===normalize(other.sku) && (!line.unit || !other.unit || normalize(line.unit)!==normalize(other.unit) || line.quantity==null || other.quantity==null || line.quantity===other.quantity);
    const wanted=supplyMaterialSearchTerms(line.description).filter(term=>!['fixture','ingredient','pack','bag','pallet'].includes(term));
    const actual=new Set(normalizeSupplyMaterial(other.description+' '+(other.sku || '')).split(' '));
    if(!wanted.length || !wanted.every(term=>actual.has(term)))return false;
    return !line.unit || !other.unit || normalize(line.unit)!==normalize(other.unit) || line.quantity==null || other.quantity==null || line.quantity===other.quantity;
  })))return false;
  return true;
}
type EvidenceSource = {id:string;userId:string|null;messageId?:string;messageDate:Date;mimeType?:string|null;extractedFacts:unknown};

/** Current authenticated participants establish the purchase; a proforma cannot create one alone. */
export async function resolveProductionOrderConfirmation(tx: Prisma.TransactionClient, organizationId: string, preferences: unknown, current: EvidenceSource, evidence: ValidatedSupplyEvidence, provenance: SupplySourceProvenance, parse: (value: unknown) => ValidatedSupplyEvidence | null) {
  const unchanged={evidence,validated:false,sourceIds:[current.id],effectiveAt:current.messageDate};
  if(!provenance.productionTeamAuthorized || !isCurrentSupplyEvidence(provenance) || !['ORDER','SHIPMENT','QUOTE'].includes(evidence.kind) || evidence.orderStatus==='CANCELLED')return unchanged;
  const participants=await tx.user.findMany({where:{organizationId,id:{in:productionMemberIds(preferences)},isActive:true},select:{id:true,email:true}});
  const memberEmails=new Set(participants.map(person=>normalize(person.email)));
  const memberSource=(source:EvidenceSource)=>participants.some(person=>person.id===source.userId);
  const buyer=(facts:ValidatedSupplyEvidence,meta:SupplySourceProvenance)=>facts.kind==='ORDER' && facts.productionRequest===true && meta.evidenceContext==='CURRENT_MESSAGE' && Boolean(meta.fromEmail && memberEmails.has(normalize(meta.fromEmail))) && (meta.direction==='SENT' || meta.senderAuthenticated===true);
  const authenticatedSupplier=(meta:SupplySourceProvenance)=>Boolean(meta.fromEmail && !memberEmails.has(normalize(meta.fromEmail)) && meta.direction==='RECEIVED' && meta.senderAuthenticated===true);
  const acknowledgement=(facts:ValidatedSupplyEvidence,meta:SupplySourceProvenance)=>['ORDER','SHIPMENT'].includes(facts.kind) && meta.evidenceContext==='CURRENT_MESSAGE' && authenticatedSupplier(meta) && (facts.supplierAcknowledgement===true || facts.productionConfirmation?.basis==='EXPLICIT_SUPPLIER_CONFIRMATION');
  const confirmation=evidence.productionConfirmation;
  const explicitPurpose=Boolean(confirmation?.purposeEvidence?.trim() && /production|replenish|distill|manufactur|bottl|packag|ingredient|raw material/i.test(confirmation.purposeEvidence));
  const knownBuyer=!confirmation?.buyerEmail || memberEmails.has(normalize(confirmation.buyerEmail));
  if(memberSource(current) && confirmation?.purpose==='PRODUCTION_REPLENISHMENT' && confirmation.basis==='EXPLICIT_SUPPLIER_CONFIRMATION' && evidence.kind==='ORDER' && evidence.supplier && evidence.lines.length && (provenance.evidenceContext==='VERIFIED_BOOTSTRAP' || explicitPurpose && knownBuyer && authenticatedSupplier(provenance)))return{evidence,validated:true,sourceIds:[current.id],effectiveAt:current.messageDate};
  if(!provenance.threadId || !memberSource(current))return unchanged;
  const siblings=await tx.supplySource.findMany({where:{organizationId,id:{not:current.id},extractionStatus:{in:['COMPLETE','REVIEW']},extractedFacts:{path:['_provenance','threadId'],equals:provenance.threadId},messageDate:{gte:new Date(current.messageDate.getTime()-30*86400000),lte:new Date(current.messageDate.getTime()+30*86400000)}},orderBy:[{messageDate:'desc'},{id:'asc'}],take:30});
  const records=[{source:current,facts:evidence,meta:provenance},...siblings.flatMap(source=>{const facts=parse(source.extractedFacts),meta=readSupplySourceProvenance(source.extractedFacts);return facts && memberSource(source) && meta.productionTeamAuthorized && isCurrentSupplyEvidence(meta) && facts.orderStatus!=='CANCELLED'?[{source,facts,meta}]:[];})];
  const buyers=records.filter(record=>buyer(record.facts,record.meta) && record.facts.lines.length);
  const acknowledgements=records.filter(record=>acknowledgement(record.facts,record.meta) && record.facts.supplier);
  const pairs=buyers.flatMap(request=>acknowledgements.flatMap(ack=>ack.source.messageDate>=request.source.messageDate && compatible(request.facts,ack.facts)?[{request,ack}]:[]));
  const purchases=new Map<string,typeof pairs>();
  for(const pair of pairs){const reference=pair.ack.facts.orderReference || pair.request.facts.orderReference;const key=reference?`reference:${reference}`:fingerprint(pair.request.facts.orderedAt || pair.request.source.messageDate.toISOString(),pair.request.facts.lines.map(line=>({sku:line.sku,description:normalize(line.description),quantity:line.quantity,unit:normalize(line.unit)})));const rows=purchases.get(key)||[];rows.push(pair);purchases.set(key,rows);}
  if(purchases.size!==1)return unchanged;
  const purchase=[...purchases.values()][0];
  const {request,ack}=purchase.sort((a,b)=>b.ack.source.messageDate.getTime()-a.ack.source.messageDate.getTime())[0];
  const isDocument=provenance.evidenceContext==='ATTACHMENT' && authenticatedSupplier(provenance) && Boolean(evidence.orderReference) && compatible(request.facts,evidence) && compatible(ack.facts,evidence);
  if(!isDocument && !purchase.some(pair=>pair.request.source.id===current.id || pair.ack.source.id===current.id))return unchanged;
  const document=isDocument?evidence:null;
  const requestedLines=request.facts.lines;
  const supplierLines=document?.lines.length?document.lines:ack.facts.lines;
  // One identified ordered item may gain its exact supplier SKU; requested units stay unchanged.
  const lines=requestedLines.map(line=>requestedLines.length===1 && supplierLines.length===1 && (!line.sku || !supplierLines[0].sku || normalize(line.sku)===normalize(supplierLines[0].sku))?{...line,sku:line.sku || supplierLines[0].sku}:line);
  const combined:ValidatedSupplyEvidence={...ack.facts,...(document?{orderHold:document.orderHold ?? ack.facts.orderHold,orderHoldDetail:document.orderHoldDetail ?? ack.facts.orderHoldDetail,supplierPromisedDate:document.supplierPromisedDate ?? ack.facts.supplierPromisedDate,paymentDueDate:document.paymentDueDate ?? ack.facts.paymentDueDate}:{}),kind:'ORDER',orderStatus:'ORDERED',supplier:ack.facts.supplier,orderReference:document?.orderReference || ack.facts.orderReference || request.facts.orderReference,orderedAt:request.facts.orderedAt || ack.facts.orderedAt,destination:document?.destination || ack.facts.destination || request.facts.destination,lines,productionConfirmation:{purpose:'PRODUCTION_REPLENISHMENT',basis:'BUYER_REQUEST_SUPPLIER_ACK'}};
  return{evidence:combined,validated:true,sourceIds:[...new Set([...purchase.flatMap(pair=>[pair.request.source.id,pair.ack.source.id]),...(isDocument?[current.id]:[])])],effectiveAt:isDocument && current.messageDate>ack.source.messageDate?current.messageDate:ack.source.messageDate};
}
