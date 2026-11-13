import { createHash } from 'node:crypto';

export type WatchedSupplyMaterial = {
  key: string; material: string; location: string; unit: string | null;
  catalogItemId: string | null; aliases: string[]; vendorRefs: Array<{ supplier: string; sku: string }>;
  needIds: string[]; latestWarningAt: Date; sharedUse: boolean;
  watchSource?: 'DX5_ALERT' | 'PRODUCTION_ORDER';
};
export const supplyStatusKey = (...values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
export const normalizeSupplyMaterial = (value?: string | null) => (value || '').normalize('NFKC').toLowerCase().replace(/(\d+)\s*(ml|kg|lb|oz)\b/g,'$1$2').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export function normalizeSupplyLocation(value?: string | null) {
  const text = normalizeSupplyMaterial((value || '').replace(/\b(\d{5})[- ]?\d{4}\b/g,'$1'));
  if (!text || ['unknown','location unknown','not specified','unspecified'].includes(text)) return '';
  return text.replace(/\bwest\b/g,'w').replace(/\beast\b/g,'e').replace(/\bnorth\b/g,'n').replace(/\bsouth\b/g,'s').replace(/\bavenue\b/g,'ave').replace(/\bstreet\b/g,'st').replace(/\broad\b/g,'rd').replace(/\bohio\b/g,'oh');
}
const plural: Record<string,string> = { bottles:'bottle',labels:'label',raisins:'raisin',corks:'cork',caps:'cap',cartons:'carton',containers:'container' };
function tokens(text: string) { return normalizeSupplyMaterial(text).split(' ').filter(Boolean).map(t=>plural[t] || t); }
const generic = new Set(['item','material','supply','supplies','product','production','label','bottle','container']);
export const supplyMaterialSearchTerms = (value:string) => tokens(value).filter(token=>token.length>1 && /[a-z]/.test(token) && !generic.has(token) && !/^\d+(ml|kg|lb|oz)$/.test(token));
export type WatchableStatusLine = { description: string; sku?: string | null; catalogItemId?: string | null; unit?: string | null; supplier?: string | null; destination?: string | null; department?: string | null; productionQuantity?: unknown };
/** Exact catalog/vendor identity or unique normalized material words; never supplier alone. */
export function matchWatchedSupplyLine(material: WatchedSupplyMaterial, line: WatchableStatusLine) {
  const wantedLocation = normalizeSupplyLocation(material.location), destination = normalizeSupplyLocation(line.destination);
  if (wantedLocation && destination && wantedLocation !== destination) return { matched:false,reason:'Known destination differs from this inventory location.',locationConfirmed:false,purposeConfirmed:false,statusConfirmed:false };
  const locationConfirmed = Boolean(wantedLocation && destination && wantedLocation === destination);
  if (material.catalogItemId && line.catalogItemId && material.catalogItemId !== line.catalogItemId) return { matched:false,reason:'The confirmed catalog identities differ.',locationConfirmed,purposeConfirmed:false,statusConfirmed:false };
  const catalog = Boolean(material.catalogItemId && material.catalogItemId === line.catalogItemId);
  const vendor = Boolean(line.sku && line.supplier && material.vendorRefs.some(ref => normalizeSupplyMaterial(ref.supplier) === normalizeSupplyMaterial(line.supplier) && ref.sku.trim().toLowerCase() === line.sku!.trim().toLowerCase()));
  const descriptionTokens = new Set(tokens(line.description));
  const description = [material.material,...material.aliases].some(alias => {
    const wanted = tokens(alias);
    return wanted.length > 0 && wanted.some(token => /[a-z]/.test(token) && !generic.has(token) && !/^\d+(ml|kg|lb|oz)$/.test(token)) && wanted.every(token => descriptionTokens.has(token));
  });
  const matched = catalog || vendor || description;
  const purposeConfirmed = !material.sharedUse || line.department === 'PRODUCTION' || line.department === 'SHARED' && Number(line.productionQuantity) > 0;
  // An absent inventory location is not a conflicting destination. It can establish
  // an order for an exact, non-shared material without proving physical replenishment.
  const statusConfirmed = matched && purposeConfirmed && (locationConfirmed || !wantedLocation && !material.sharedUse);
  return { matched, locationConfirmed, purposeConfirmed, statusConfirmed, reason: !matched ? 'No exact catalog, supplier SKU or material-word match.' : !purposeConfirmed ? 'Shared-use material purchase purpose is unconfirmed.' : !locationConfirmed ? 'Material order matched; physical inventory destination remains unconfirmed.' : catalog ? 'Canonical material and destination match.' : vendor ? 'Reviewed supplier SKU and destination match.' : 'Normalized material words and destination match.' };
}

export type StatusArrival = { source:string; precision:string; startDate:string; endDate:string|null; timeStart:string|null; timeEnd:string|null; timezone:string; observedAt:Date; sourceEventAt:Date; current:boolean };
export type StatusShipment = { id:string; status:string; statusEventAt:Date|null; deliveredAt:Date|null; returnedAt:Date|null; checkError:string|null; lastSuccessfulCheckAt:Date|null; providerMode?:string|null;provider?:string|null; lines:Array<{lineId:string;quantity:unknown}>; arrivalEstimates:StatusArrival[] };
export type SupplyOrderHold = 'PREPAYMENT_REQUIRED' | 'PAYMENT_PENDING' | 'OTHER' | 'RELEASED';
export type StatusOrder = { id:string; supplier:string; orderReference:string|null; destination:string|null; status:string; ignored:boolean; historicalOutcomeUnknown:boolean; ownerName:string|null; orderedAt:Date|null; createdAt:Date; lastEvidenceAt:Date|null; lines:Array<WatchableStatusLine & {id:string;quantity:unknown;ignored:boolean;backorderedQuantity:unknown}>; shipments:StatusShipment[]; completeDeliveryEvidence:Array<{at:Date|null;complete:boolean;observedAt?:Date;through?:Date}>; orderHold?:SupplyOrderHold|null; supplierPromisedDate?:string|null; paymentDueDate?:string|null };
export type StatusDismissal = { cycleKey:string; at:Date };
export type SupplyStatusCard = {
  id:string; needId:string; cycleKey:string; material:string; location:string; lastAlertAt:string;
  reportedQuantity:number|null;reportedThreshold:number|null;unit:string|null;warningCount:number;
  status:'NO_ORDER_FOUND'|'ORDERED'|'INCOMING'|'ATTENTION'; statusLabel:string;detail:string;
  arrival:Omit<StatusArrival,'current'|'sourceEventAt'|'observedAt'> & {observedAt:string}|null;
  supplier:string|null;orderReference:string|null;shipmentStatus:string|null;ownerName:string|null;
  watchSource:'DX5_ALERT'|'PRODUCTION_ORDER';triggerAt:string;supplierPromisedDate:string|null;paymentDueDate:string|null;
};
const number = (value:unknown) => value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
function arrivalFor(shipments:StatusShipment[]) {
  const rank = ['APPOINTMENT','CARRIER','SUPPLIER_PROMISE','MANUAL','PREDICTION'];
  const position = (source:string) => rank.includes(source) ? rank.indexOf(source) : rank.length;
  const estimate = shipments.filter(s=>s.providerMode!=='test').flatMap(s=>s.arrivalEstimates).filter(a=>a.current).sort((a,b)=>position(a.source)-position(b.source)||b.sourceEventAt.getTime()-a.sourceEventAt.getTime())[0];
  if (!estimate) return null;
  const {current:_current,sourceEventAt:_event,observedAt,...rest}=estimate; return {...rest,observedAt:observedAt.toISOString()};
}
function lineDelivery(order:StatusOrder, lines:StatusOrder['lines']) {
  if (order.status === 'CANCELLED' || lines.some(l=>Number(l.backorderedQuantity || 0)>0)) return null;
  const known = order.shipments.filter(s=>s.provider!=='SOURCE_WITHDRAWN' && s.providerMode!=='test' && (s.lines.some(link=>lines.some(l=>l.id===link.lineId)) || !s.lines.length));
  if (known.some(s=>s.returnedAt || ['RETURNED','CANCELLED'].includes(s.status))) return null;
  // A newer partial/corrected report supersedes an older whole-order promise.
  const explicit = [...order.completeDeliveryEvidence].sort((a,b)=>(b.observedAt || b.at || new Date(0)).getTime()-(a.observedAt || a.at || new Date(0)).getTime())[0];
  const deliveredTimes:Date[]=[];
  for (const line of lines) {
    const qty=number(line.quantity); if(qty===null || qty<=0) {if(explicit?.complete && explicit.at && known.every(s=>s.status==='DELIVERED'))return {at:explicit.at,through:explicit.through || new Date(explicit.at.getTime()+86400000),precision:'DATE' as const};return null;}
    const linked=order.shipments.filter(shipment=>shipment.provider!=='SOURCE_WITHDRAWN' && shipment.providerMode!=='test').flatMap(shipment=>shipment.lines.filter(l=>l.lineId===line.id).map(link=>({shipment,quantity:number(link.quantity)})));
    if(!linked.length || linked.some(l=>l.quantity===null || l.shipment.status!=='DELIVERED' || l.shipment.returnedAt) || linked.reduce((sum,l)=>sum+(l.quantity || 0),0)<qty) {if(explicit?.complete && explicit.at && known.every(s=>s.status==='DELIVERED'))return {at:explicit.at,through:explicit.through || new Date(explicit.at.getTime()+86400000),precision:'DATE' as const};return null;}
    for(const link of linked){const at=link.shipment.deliveredAt;if(!at){if(explicit?.complete && explicit.at && known.every(s=>s.status==='DELIVERED'))return {at:explicit.at,through:explicit.through || new Date(explicit.at.getTime()+86400000),precision:'DATE' as const};return null;}deliveredTimes.push(at);}
  }
  const last=deliveredTimes.length ? new Date(Math.max(...deliveredTimes.map(d=>d.getTime()))) : null;
  if(last && explicit && !explicit.complete && explicit.observedAt && explicit.observedAt>=last)return null;
  return last ? {at:last,through:last,precision:'INSTANT' as const} : null;
}
export function buildSupplyStatusCard(material:WatchedSupplyMaterial, input:{firstWarningAt:Date;latestWarningAt:Date;warningCount:number;reportedQuantity:unknown;reportedThreshold:unknown;orders:StatusOrder[];dismissals:StatusDismissal[]}, now=new Date()):SupplyStatusCard|null {
  const candidates=input.orders.flatMap(order=>{
    if(order.ignored)return[];
    const lines=order.lines.filter(line=>!line.ignored && matchWatchedSupplyLine(material,{...line,supplier:order.supplier,destination:order.destination}).matched);
    if(!lines.length)return[];
    const reliable=lines.every(line=>matchWatchedSupplyLine(material,{...line,supplier:order.supplier,destination:order.destination}).statusConfirmed);
    const physicalMatch=lines.every(line=>{const match=matchWatchedSupplyLine(material,{...line,supplier:order.supplier,destination:order.destination});return match.locationConfirmed && match.purposeConfirmed;});
    const related=order.shipments.filter(s=>s.provider!=='SOURCE_WITHDRAWN' && (!s.lines.length || s.lines.some(link=>lines.some(l=>l.id===link.lineId))));
    const shipments=related.some(s=>s.providerMode!=='test')?related.filter(s=>s.providerMode!=='test'):related;
    const completion=physicalMatch?lineDelivery(order,lines):null;return[{order,lines,shipments,reliable,completion,completedAt:completion?.at || null}];
  });
  const completed=candidates.filter(c=>c.completedAt).sort((a,b)=>b.completedAt!.getTime()-a.completedAt!.getTime());
  const latestCompletion=completed[0] || null;
  const uncertainDelivery=latestCompletion?.completion?.precision==='DATE' && input.latestWarningAt>=latestCompletion.completion.at && input.latestWarningAt<latestCompletion.completion.through ? latestCompletion : null;
  const provenCompletion=completed.find(candidate=>candidate.completion && (candidate.completion.precision==='DATE'?candidate.completion.through<=input.latestWarningAt:candidate.completion.at<input.latestWarningAt));
  const boundary=provenCompletion?.completedAt || null;
  const latestDelivered=latestCompletion?.completedAt || null;
  const cycleKey=supplyStatusKey(material.needIds[0],boundary?.toISOString() || 'initial');
  // A new usage warning, raw ID or catalog enrichment is not a new physical cycle.
  if(input.dismissals.some(d=>!boundary || d.at>=boundary || d.at>=input.latestWarningAt))return null;
  const cycleTiming=(candidate:typeof candidates[number])=>{
    const orderingBoundary=latestDelivered || boundary;
    if(!orderingBoundary)return'current';
    if(!candidate.order.orderedAt)return'unknown';
    // orderedAt is a calendar date; email/provider update clocks cannot make an old purchase new.
    const placed=candidate.order.orderedAt.toISOString().slice(0,10),delivered=orderingBoundary.toISOString().slice(0,10);
    return placed>delivered?'current':placed<delivered?'previous':'unknown';
  };
  const open=candidates.filter(c=>!c.completedAt && cycleTiming(c)==='current' && c.order.status!=='CANCELLED' && !c.order.historicalOutcomeUnknown && (!c.shipments.length || c.shipments.some(s=>!['RETURNED','CANCELLED'].includes(s.status))));
  if(latestDelivered && latestDelivered>=input.latestWarningAt && !uncertainDelivery && !open.some(c=>c.reliable))return null;
  const active=candidates.filter(c=>!c.completedAt && cycleTiming(c)!=='previous' && !c.order.historicalOutcomeUnknown).sort((a,b)=>Number(b.reliable)-Number(a.reliable)||(b.order.lastEvidenceAt || b.order.orderedAt || b.order.createdAt).getTime()-(a.order.lastEvidenceAt || a.order.orderedAt || a.order.createdAt).getTime());
  const chosen=active[0] || uncertainDelivery;
  let status:SupplyStatusCard['status']='NO_ORDER_FOUND',statusLabel='No order found',detail='No reliable matching replenishment order has been found in the monitored email.',arrival:SupplyStatusCard['arrival']=null,shipmentStatus:string|null=null;
  if(chosen){
    const {order,lines,shipments,reliable}=chosen;
    shipmentStatus=shipments.find(s=>['RETURNED','CANCELLED','DELAYED','PICKUP_REQUIRED'].includes(s.status))?.status || shipments.find(s=>s.status!=='DELIVERED')?.status || shipments[0]?.status || null;
    if(shipments.length && shipments.every(s=>s.providerMode==='test')){status='ATTENTION';statusLabel='Test tracking only';detail='Test tracking does not establish an operational arrival or completed delivery.';}
    else if(chosen===uncertainDelivery){status='ATTENTION';statusLabel='Delivery timing uncertain';detail='The supplier delivery and inventory warning share a calendar date. Their exact order is unknown.';}
    else if(cycleTiming(chosen)==='unknown'){status='ATTENTION';statusLabel='Order timing unconfirmed';detail='A matching material order exists, but it is not established as a new purchase after the last replenishment.';}
    else if(!reliable){status='ATTENTION';statusLabel='Order match uncertain';detail='A possible material order was found, but its location or shared-use purchase purpose is unconfirmed.';}
    else if(order.status==='CANCELLED'){status='ATTENTION';statusLabel='Order cancelled';detail='The matching order was cancelled; no completed replenishment is established.';}
    else if(order.orderHold && order.orderHold!=='RELEASED'){status='ATTENTION';statusLabel=['PREPAYMENT_REQUIRED','PAYMENT_PENDING'].includes(order.orderHold)?'Awaiting payment':'On hold';detail=order.orderHold==='PREPAYMENT_REQUIRED'?'The supplier requires prepayment before releasing this production order.':order.orderHold==='PAYMENT_PENDING'?'The production order is waiting for the scheduled payment to clear.':'The supplier has placed this production order on hold.';}
    else if(shipments.some(s=>s.returnedAt || s.status==='RETURNED')){status='ATTENTION';statusLabel='Shipment returned';detail='The matching shipment was returned; this is not delivery to the production location.';}
    else if(shipments.some(s=>['CANCELLED','DELAYED','PICKUP_REQUIRED'].includes(s.status)) || lines.some(l=>Number(l.backorderedQuantity || 0)>0)){status='ATTENTION';statusLabel='Delivery needs attention';detail='The matching replenishment has a delay, backorder, cancellation or pickup exception.';arrival=arrivalFor(shipments);}
    else if(shipments.some(s=>s.checkError)){status='ATTENTION';statusLabel='Tracking needs attention';detail='Tracking could not refresh. The last valid arrival estimate is retained when available.';arrival=arrivalFor(shipments);}
    else if(shipments.some(s=>s.status==='DELIVERED')){status='ATTENTION';statusLabel='Delivery needs checking';detail='Delivery was reported, but complete delivery of this material is not established.';arrival=arrivalFor(shipments);}
    else if(shipments.some(s=>['IN_TRANSIT','OUT_FOR_DELIVERY'].includes(s.status))){status='INCOMING';statusLabel='Incoming';detail='A matching material shipment is on its way.';arrival=arrivalFor(shipments);}
    else {status='ORDERED';statusLabel='Order found';detail=shipmentStatus==='LABEL_CREATED'?'A shipping label exists; carrier receipt and arrival remain unconfirmed.':'A matching order was found; current arrival information is unavailable.';arrival=arrivalFor(shipments);}
    let localToday='';try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:arrival?.timezone || 'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);localToday=['year','month','day'].map(key=>parts.find(part=>part.type===key)!.value).join('-');}catch{/* An invalid legacy timezone does not invent a delay. */}
    if(arrival && !['RETURNED','CANCELLED','DELIVERED'].includes(shipmentStatus || '') && localToday>(arrival.endDate || arrival.startDate)){status='ATTENTION';statusLabel='Delivery needs attention';detail='The last reported arrival date has passed; a later completed delivery is not established.';}
  }
  return {id:material.needIds[0],needId:material.needIds[0],cycleKey,material:material.material,location:material.location,lastAlertAt:input.latestWarningAt.toISOString(),reportedQuantity:number(input.reportedQuantity),reportedThreshold:number(input.reportedThreshold),unit:material.unit,warningCount:input.warningCount,status,statusLabel,detail,arrival,supplier:chosen?.order.supplier || null,orderReference:chosen?.order.orderReference || null,shipmentStatus,ownerName:chosen?.order.ownerName || null,watchSource:material.watchSource || 'DX5_ALERT',triggerAt:input.latestWarningAt.toISOString(),supplierPromisedDate:chosen?.order.supplierPromisedDate || null,paymentDueDate:chosen?.order.paymentDueDate || null};
}
