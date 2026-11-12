import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupplyStatusCard, matchWatchedSupplyLine, normalizeSupplyLocation, type StatusOrder, type StatusShipment, type WatchedSupplyMaterial } from '../lib/productionSupplies/statusDomain';

const at=(day:number,hour=12)=>new Date(`2026-11-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00Z`);
const material:WatchedSupplyMaterial={key:'material-location',material:'750mL Tennessee Bottles',location:'Production',unit:'units',catalogItemId:'bottles',aliases:[],vendorRefs:[{supplier:'Reviewed supplier',sku:'TEST100'}],needIds:['need'],latestWarningAt:at(10),sharedUse:false};
const shipment=(patch:Partial<StatusShipment>={}):StatusShipment=>({id:'shipment',status:'IN_TRANSIT',statusEventAt:at(11),deliveredAt:null,returnedAt:null,checkError:null,lastSuccessfulCheckAt:at(11),lines:[{lineId:'line',quantity:10}],arrivalEstimates:[],...patch});
const order=(patch:Partial<StatusOrder>={}):StatusOrder=>({id:'order',supplier:'Reviewed supplier',orderReference:'TEST-ORDER',destination:'Production',status:'ORDERED',ignored:false,historicalOutcomeUnknown:false,ownerName:null,orderedAt:at(10),createdAt:at(10),lastEvidenceAt:at(11),lines:[{id:'line',description:'Tennessee 750 ML bottles',sku:'TEST100',catalogItemId:'bottles',quantity:10,unit:'case',department:'PRODUCTION',ignored:false,backorderedQuantity:null}],shipments:[shipment()],completeDeliveryEvidence:[],...patch});
const input=(orders:StatusOrder[]=[],latestWarningAt=at(10))=>({firstWarningAt:at(10),latestWarningAt,warningCount:1,reportedQuantity:5,reportedThreshold:10,orders,dismissals:[]});
const card=(orders:StatusOrder[]=[],latest=at(10))=>buildSupplyStatusCard(material,input(orders,latest),at(12));
const completed=()=>order({shipments:[shipment({status:'DELIVERED',deliveredAt:at(11),statusEventAt:at(11)})]});

test('status wording reports no matching evidence without asserting that nobody ordered',()=>{
  assert.equal(card()!.statusLabel,'No order found');assert.match(card()!.detail,/found in the monitored email/);
});
test('matching permits reordered normalized material words and reviewed exact SKU, never supplier alone or raw-code shortening',()=>{
  assert.equal(matchWatchedSupplyLine({...material,catalogItemId:null},{description:'Tennessee 750 ML bottle 6 pack',destination:'Production'}).matched,true);
  assert.equal(matchWatchedSupplyLine(material,{description:'Unrelated bar cups',supplier:'Reviewed supplier',sku:'TEST1000',destination:'Production'}).matched,false);
  assert.equal(matchWatchedSupplyLine(material,{description:'Unrelated bar cups',supplier:'Reviewed supplier',sku:'TEST100',destination:'Production'}).matched,true);
  assert.equal(matchWatchedSupplyLine(material,{description:material.material,catalogItemId:'different-catalog',destination:'Production'}).matched,false);
  assert.equal(normalizeSupplyLocation('985 West 6th Avenue, Columbus OH 43212-2601'),normalizeSupplyLocation('985 W 6th Ave Columbus OH 43212'));
});
test('repeated usage warnings and catalog/raw-ID enrichment do not revive a dismissed physical cycle',()=>{
  const initial=card()!;const dismissed=[{cycleKey:initial.cycleKey,at:at(10,13)}];
  for(const enriched of [material,{...material,key:'new-raw-id',aliases:['RAW100'],catalogItemId:'enriched-catalog'}])assert.equal(buildSupplyStatusCard(enriched,{...input([],at(12)),dismissals:dismissed}),null);
});
test('a complete matched delivery hides the prior alert without internal receipt or inventory mutations',()=>{
  assert.equal(card([completed()]),null);
});
test('a fresh warning after replenishment opens a new cycle; an older replay cannot resurface it',()=>{
  const initial=card()!;const next=card([completed()],at(12))!;assert.equal(next.status,'NO_ORDER_FOUND');assert.notEqual(next.cycleKey,initial.cycleKey);
  assert.equal(buildSupplyStatusCard(material,{...input([completed()],at(10)),dismissals:[{cycleKey:initial.cycleKey,at:at(10,13)}]}),null);
  assert.ok(buildSupplyStatusCard(material,{...input([completed()],at(12)),dismissals:[{cycleKey:initial.cycleKey,at:at(10,13)}]}));
});
test('partial dispatch, a first delivered parcel and unknown contents cannot close the material cycle',()=>{
  const delivered=shipment({status:'DELIVERED',deliveredAt:at(11),lines:[{lineId:'line',quantity:5}]});
  assert.ok(card([order({shipments:[delivered]})]));
  assert.ok(card([order({shipments:[delivered,shipment({id:'second',lines:[{lineId:'line',quantity:5}]})]})]));
  assert.ok(card([order({shipments:[shipment({status:'DELIVERED',deliveredAt:at(11),lines:[]})]})]));
  assert.ok(card([order({lines:[{...order().lines[0],backorderedQuantity:2}],shipments:completed().shipments})]));
});
test('an unrelated delivered shipment cannot hide the watched material still in transit',()=>{
  const other=shipment({id:'other',status:'DELIVERED',deliveredAt:at(11),lines:[{lineId:'unrelated',quantity:10}]});
  assert.equal(card([order({shipments:[other,shipment()]})])!.status,'INCOMING');
});
test('returned/cancelled supplies and unknown location or shared purchase purpose stay visible',()=>{
  for(const status of ['RETURNED','CANCELLED'])assert.equal(card([order({shipments:[shipment({status,deliveredAt:at(11)})]})])!.status,'ATTENTION');
  assert.equal(card([order({status:'CANCELLED',shipments:[]})])!.statusLabel,'Order cancelled');
  assert.equal(buildSupplyStatusCard({...material,location:'Location unknown'},input([completed()]))!.statusLabel,'Order match uncertain');
  assert.equal(buildSupplyStatusCard({...material,sharedUse:true},input([order({lines:[{...order().lines[0],department:'NEEDS_REVIEW'}],shipments:completed().shipments})]))!.statusLabel,'Order match uncertain');
});
test('delivery report/update time alone cannot close a newer inventory alert',()=>{
  assert.ok(card([order({shipments:[shipment({status:'DELIVERED',statusEventAt:at(14),deliveredAt:null})]})],at(12)));
  const late=order({shipments:[shipment({status:'DELIVERED',lines:[],statusEventAt:at(14)})],completeDeliveryEvidence:[{complete:true,at:at(11,0),observedAt:at(14)}]});
  assert.equal(card([late],at(12))!.status,'NO_ORDER_FOUND');
  assert.equal(card([late],at(11,10))!.statusLabel,'Delivery timing uncertain');
});
test('newer explicit partial delivery correction defeats older whole-order completion evidence',()=>{
  const corrected=order({shipments:[shipment({status:'DELIVERED',deliveredAt:at(11),lines:[]})],completeDeliveryEvidence:[{complete:true,at:at(11,0),observedAt:at(11)},{complete:false,at:null,observedAt:at(12)}]});
  assert.ok(card([corrected]));
});
test('old unresolved orders do not block completed replenishment or claim to cover a new post-delivery warning',()=>{
  const old=order({id:'old',shipments:[shipment({statusEventAt:at(14)})],orderedAt:at(8),lastEvidenceAt:at(14)});
  assert.equal(card([old,completed()]),null);
  assert.equal(card([old,completed()],at(12))!.status,'NO_ORDER_FOUND');
  assert.equal(card([order({id:'unknown',orderedAt:null,lastEvidenceAt:at(14)}),completed()],at(12))!.statusLabel,'Order timing unconfirmed');
});
test('tracking outages retain only the last valid current estimate; withdrawals never revive superseded ETA',()=>{
  const estimate={source:'CARRIER',precision:'DATE',startDate:'2026-11-20',endDate:null,timeStart:null,timeEnd:null,timezone:'America/New_York',observedAt:at(11),sourceEventAt:at(11),current:true};
  const stale=card([order({shipments:[shipment({checkError:'Temporary failure',arrivalEstimates:[estimate]})]})])!;
  assert.equal(stale.statusLabel,'Tracking needs attention');assert.equal(stale.arrival?.startDate,'2026-11-20');
  assert.equal(card([order({shipments:[shipment({arrivalEstimates:[{...estimate,current:false}]})]})])!.arrival,null);
});
test('date ranges stay current through the final day and test tracking never completes an operational cycle',()=>{
  const range={source:'CARRIER',precision:'DATE_RANGE',startDate:'2026-11-10',endDate:'2026-11-20',timeStart:null,timeEnd:null,timezone:'America/New_York',observedAt:at(11),sourceEventAt:at(11),current:true};
  assert.equal(card([order({shipments:[shipment({arrivalEstimates:[range]})]})])!.status,'INCOMING');
  const testOnly=card([order({shipments:[shipment({providerMode:'test',status:'DELIVERED',deliveredAt:at(11),arrivalEstimates:[range]})]})])!;
  assert.equal(testOnly.statusLabel,'Test tracking only');assert.equal(testOnly.arrival,null);
  assert.equal(card([order({shipments:[shipment(),shipment({id:'test-only',providerMode:'test',status:'RETURNED'})]})])!.status,'INCOMING');
});
