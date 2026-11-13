import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { resolveProductionOrderConfirmation, type SupplySourceProvenance } from '../lib/productionSupplies/orderConfirmation';
import { isSupplierOrderIdentifier, supplyEvidenceInput, type ValidatedSupplyEvidence } from '../lib/productionSupplies/service';
import { scopeSupplyEvidence } from '../lib/productionSupplies/watch';
import { getWatchedSupplyMaterials } from '../lib/productionSupplies/status';

const organizationId='fixture-tenant';
const at=(hour:number)=>new Date(`2026-11-08T${String(hour).padStart(2,'0')}:00:00Z`);
const teamId='11111111-1111-4111-8111-111111111111';
const preferences={accountConfiguration:{version:1,territories:[],categories:[],fields:[],teams:[{id:teamId,name:'Production',memberIds:['owner','buyer']}]},productionSupplies:{productionTeamId:teamId}};
const participants=[{id:'owner',email:'owner@fixture.invalid'},{id:'buyer',email:'buyer@fixture.invalid'}];
const meta:SupplySourceProvenance={threadId:'fixture-current-thread',evidenceContext:'CURRENT_MESSAGE',contentVersion:'SUPPLY_CURRENT_V1',direction:'RECEIVED',fromEmail:'buyer@fixture.invalid',senderAuthenticated:true,productionTeamAuthorized:true};
const facts=(patch:Partial<ValidatedSupplyEvidence>={}):ValidatedSupplyEvidence=>supplyEvidenceInput.shape.evidence.parse({kind:'ORDER',supplier:'Fixture ingredient supplier',orderedAt:'2026-11-08',lines:[{description:'Fixture cane ingredient',sku:'TEST-45',quantity:45,unit:'bags'}],shipments:[],...patch})!;
const request=facts({productionRequest:true});
const acknowledgement=facts({kind:'SHIPMENT',orderedAt:null,orderReference:'TEST-ORDER-45',lines:[],supplierAcknowledgement:true,orderHold:'PREPAYMENT_REQUIRED',supplierPromisedDate:'2026-11-17'});
const supplierMeta={...meta,fromEmail:'supplier@vendor.invalid'};
const source=(id:string,time:Date,evidence:ValidatedSupplyEvidence,provenance:SupplySourceProvenance)=>({id,organizationId,userId:'owner',messageDate:time,extractedFacts:{...evidence,_provenance:provenance}});
const parse=(value:unknown)=>{const parsed=supplyEvidenceInput.shape.evidence.safeParse(value);return parsed.success && parsed.data?parsed.data:null;};
function db(siblings:ReturnType<typeof source>[]=[]){const queries:unknown[]=[];return{queries,tx:{user:{findMany:async()=>participants},supplySource:{findMany:async(query:unknown)=>{queries.push(query);return siblings;}}} as unknown as Prisma.TransactionClient};}

test('authenticated received Production buyer request and supplier acknowledgement open one verified purchase',async()=>{
  const fake=db([source('request',at(9),request,meta)]),current=source('ack',at(10),acknowledgement,supplierMeta);
  const result=await resolveProductionOrderConfirmation(fake.tx,organizationId,preferences,current,acknowledgement,supplierMeta,parse);
  assert.equal(result.validated,true);assert.equal(result.evidence.kind,'ORDER');assert.equal(result.evidence.lines[0].quantity,45);assert.equal(result.evidence.orderReference,'TEST-ORDER-45');
  assert.equal(result.evidence.orderHold,'PREPAYMENT_REQUIRED');assert.equal(result.evidence.supplierPromisedDate,'2026-11-17');assert.equal(result.evidence.shipments.length,0);
  assert.ok(fake.queries.every(query=>(query as {where:{organizationId:string}}).where.organizationId===organizationId));
});

test('multiple acknowledgements for one exact purchase collapse while distinct current references stay ambiguous',async()=>{
  const ack1=source('ack1',at(10),acknowledgement,supplierMeta),ack2=source('ack2',at(11),{...acknowledgement,orderHold:'RELEASED'},supplierMeta);
  const current=source('request',at(9),request,meta);
  const collapsed=await resolveProductionOrderConfirmation(db([ack1,ack2]).tx,organizationId,preferences,current,request,meta,parse);
  assert.equal(collapsed.validated,true);assert.equal(collapsed.evidence.orderHold,'RELEASED');assert.equal(collapsed.sourceIds.length,3);
  const other=source('different-order',at(11),{...acknowledgement,orderReference:'TEST-ORDER-46'},supplierMeta);
  assert.equal((await resolveProductionOrderConfirmation(db([ack1,other]).tx,organizationId,preferences,current,request,meta,parse)).validated,false);
});

test('quotes, unauthenticated buyers, foreign buyers and quoted contexts cannot create confirmed production watches',async()=>{
  for(const patch of [{senderAuthenticated:false},{fromEmail:'outsider@other.invalid'},{evidenceContext:'QUOTED_HISTORY' as const}]){
    const unsafe={...meta,...patch};const fake=db([source('request',at(9),request,unsafe)]);
    assert.equal((await resolveProductionOrderConfirmation(fake.tx,organizationId,preferences,source('ack',at(10),acknowledgement,supplierMeta),acknowledgement,supplierMeta,parse)).validated,false);
  }
  const quote={...request,kind:'QUOTE' as const};
  assert.equal((await resolveProductionOrderConfirmation(db([source('quote',at(9),quote,meta)]).tx,organizationId,preferences,source('ack',at(10),acknowledgement,supplierMeta),acknowledgement,supplierMeta,parse)).validated,false);
});

test('explicit supplier confirmation still requires current production purpose and known Production recipient',async()=>{
  const confirmation={purpose:'PRODUCTION_REPLENISHMENT' as const,basis:'EXPLICIT_SUPPLIER_CONFIRMATION' as const};
  const ordinary=facts({productionConfirmation:confirmation});const current=source('ordinary',at(10),ordinary,supplierMeta);
  assert.equal((await resolveProductionOrderConfirmation(db().tx,organizationId,preferences,current,ordinary,supplierMeta,parse)).validated,false);
  const confirmed=facts({productionConfirmation:{...confirmation,buyerEmail:'buyer@fixture.invalid',purposeEvidence:'Explicit production ingredient replenishment purchase'}});
  assert.equal((await resolveProductionOrderConfirmation(db().tx,organizationId,preferences,{...current,extractedFacts:confirmed},confirmed,supplierMeta,parse)).validated,true);
  const wrongBuyer=facts({productionConfirmation:{...confirmed.productionConfirmation!,buyerEmail:'outside@unrelated.invalid'}});
  assert.equal((await resolveProductionOrderConfirmation(db().tx,organizationId,preferences,current,wrongBuyer,supplierMeta,parse)).validated,false);
});

test('a confirmed-order watch has its own retained provenance and does not fabricate an inventory warning',async()=>{
  const need={id:'confirmed-need',description:'Fixture cane ingredient',location:'Fixture production',unit:'bags',catalogItemId:null,createdAt:at(9),latestWarningAt:null,warnings:[],allocations:[{line:{description:'Fixture cane ingredient',sku:'TEST-45',order:{supplier:'Fixture ingredient supplier',ignored:false}}}],audits:[{detail:{triggerAt:at(10).toISOString(),provenanceVersion:1},createdAt:at(10),orderId:'confirmed-order'}]};
  const fake={supplyNeed:{findMany:async()=>[need]},supplyCatalogItem:{findMany:async()=>[]}};
  const materials=await getWatchedSupplyMaterials(organizationId,fake as unknown as Prisma.TransactionClient);
  assert.equal(materials.length,1);assert.equal(materials[0].watchSource,'PRODUCTION_ORDER');assert.equal(materials[0].latestWarningAt.getTime(),at(10).getTime());assert.equal(need.warnings.length,0);
  assert.equal((await scopeSupplyEvidence(organizationId,facts({productionConfirmation:{purpose:'PRODUCTION_REPLENISHMENT',basis:'EXPLICIT_SUPPLIER_CONFIRMATION'}}),fake as unknown as Prisma.TransactionClient,{confirmedProductionOrder:true})).evidence?.kind,'ORDER');
});

test('an unknown-location warning joined to a confirmed watch remains physically unlocated',async()=>{
  const need={id:'confirmed-need',description:'Cane sugar',location:'Known production destination',unit:'bags',catalogItemId:null,createdAt:at(9),latestWarningAt:at(11),warnings:[{warningAt:at(11),reportedQuantity:2,reportedThreshold:5,source:{extractedFacts:{kind:'WARNING',warningSource:'DISTILLX5_EMAIL',warning:{material:'Cane sugar',location:'Location unknown'}}}}],allocations:[],audits:[{detail:{triggerAt:at(10).toISOString(),provenanceVersion:1},createdAt:at(10),orderId:'confirmed-order'}]};
  const fake={supplyNeed:{findMany:async()=>[need]},supplyCatalogItem:{findMany:async()=>[]}};
  const materials=await getWatchedSupplyMaterials(organizationId,fake as unknown as Prisma.TransactionClient);
  assert.equal(materials.length,1);assert.equal(materials[0].needIds[0],need.id);assert.equal(materials[0].location,'Location unknown');assert.equal(need.location,'Known production destination');
});

test('supplier identifiers preserve raw codes and reject prose synthesized from a subject or product',()=>{
  assert.equal(isSupplierOrderIdentifier('TEST100'),true);assert.equal(isSupplierOrderIdentifier('TEST1000'),true);
  assert.equal(isSupplierOrderIdentifier('More Glass for Fixture'),false);assert.equal(isSupplierOrderIdentifier('Supplier order for 3 pallets of bottles'),false);
});

test('a unique confirmed current purchase admits its identifying proforma without converting requested raw units',async()=>{
  const requested=facts({productionRequest:true,lines:[{description:'Cane sugar',quantity:3,unit:'pallets'}]});
  const ack={...acknowledgement,orderReference:'TEST-DOC-45'};
  const document=facts({kind:'QUOTE',orderedAt:null,orderReference:'TEST-DOC-45',lines:[{description:'Refined Cane Sugar Product',sku:'TEST-CANE-X',quantity:2520,unit:'units'}],orderHold:'PREPAYMENT_REQUIRED',supplierPromisedDate:'2026-11-17'});
  const docMeta={...supplierMeta,evidenceContext:'ATTACHMENT' as const};
  const current=source('document',at(11),document,docMeta);
  const fake=db([source('request',at(9),requested,meta),source('ack',at(10),ack,supplierMeta)]);
  const result=await resolveProductionOrderConfirmation(fake.tx,organizationId,preferences,current,document,docMeta,parse);
  assert.equal(result.validated,true);assert.equal(result.evidence.lines.length,1);assert.equal(result.evidence.lines[0].quantity,3);assert.equal(result.evidence.lines[0].unit,'pallets');assert.equal(result.evidence.lines[0].sku,'TEST-CANE-X');
  assert.equal(document.lines[0].quantity,2520);assert.equal(document.lines[0].unit,'units');
  assert.equal((await resolveProductionOrderConfirmation(db().tx,organizationId,preferences,current,document,docMeta,parse)).validated,false);
});

test('same-thread acknowledgements cannot override conflicting suppliers, materials, references or same-unit quantities',async()=>{
  for(const patch of [{supplier:'Different supplier'},{lines:[{description:'Unrelated glass container',quantity:45,unit:'bags'}]},{orderReference:'OTHER-REF',lines:[{description:'Fixture cane ingredient',sku:'DIFFERENT-SKU',quantity:45,unit:'bags'}]},{lines:[{description:'Fixture cane ingredient',sku:'TEST-45',quantity:90,unit:'bags'}]}]){
    const conflicting=facts({...acknowledgement,...patch});
    assert.equal((await resolveProductionOrderConfirmation(db([source('request',at(9),request,meta)]).tx,organizationId,preferences,source('ack',at(10),conflicting,supplierMeta),conflicting,supplierMeta,parse)).validated,false);
  }
});

test('a mixed supplier document retains raw unrelated lines without enrolling them as requested production materials',async()=>{
  const requested=facts({productionRequest:true,lines:[{description:'Cane sugar',quantity:45,unit:'bags'}]});
  const document=facts({kind:'QUOTE',orderReference:'TEST-ORDER-45',lines:[{description:'Cane sugar',quantity:45,unit:'bags'},{description:'Bar cups',quantity:1,unit:'case'}]});
  const documentMeta={...supplierMeta,evidenceContext:'ATTACHMENT' as const};
  const result=await resolveProductionOrderConfirmation(db([source('request',at(9),requested,meta),source('ack',at(10),acknowledgement,supplierMeta)]).tx,organizationId,preferences,source('doc',at(11),document,documentMeta),document,documentMeta,parse);
  assert.equal(result.validated,true);assert.deepEqual(result.evidence.lines.map(line=>line.description),['Cane sugar']);assert.equal(document.lines.length,2);
});
