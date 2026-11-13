import assert from 'node:assert/strict';
import test from 'node:test';
import type {PrismaClient} from '@prisma/client';
import {trustedDx5WarningIdentity,compatibleDx5WarningIdentity} from '../lib/productionSupplies/dx5WarningIdentity';
import {getSupplyStatusDashboard,getWatchedSupplyMaterials} from '../lib/productionSupplies/status';
import {supplyStatusKey} from '../lib/productionSupplies/statusDomain';
import {ingestEvidence} from '../lib/productionSupplies/service';

const subject='Inventory Low: Factory Mineral (CODE-A)';
const at=(day:number)=>new Date(`2026-11-${String(day).padStart(2,'0')}T12:00:00Z`);
function source(material:string,materialId:string|null,patch:Record<string,unknown>={}){
  return {provider:'GOOGLE',mailboxConnectionId:'owned-mailbox',subject,extractedFacts:{kind:'WARNING',warningSource:'DISTILLX5_EMAIL',warning:{material,materialId,location:'Location unknown',quantity:2,threshold:5,unit:'units'},_provenance:{contentVersion:'SUPPLY_CURRENT_V1',evidenceContext:'CURRENT_MESSAGE',productionTeamAuthorized:true}},...patch};
}
const split=()=>source('Factory Mineral','CODE-A');
const full=()=>source('FACTORY MINERAL (CODE-A)',null);

test('an exact trusted full label survives the observed model base/parenthetical split without rewriting raw fields',()=>{
  const a=split(),b=full(),before=structuredClone([a,b]);
  const first=trustedDx5WarningIdentity(a)!,second=trustedDx5WarningIdentity(b)!;
  assert.equal(first.key,second.key);assert.equal(first.label,'Factory Mineral (CODE-A)');assert.equal(first.inferredLabelFragment,true);assert.equal(first.explicitMaterialId,null);
  assert.deepEqual([a,b],before);assert.equal(a.extractedFacts.warning.materialId,'CODE-A');
});

test('nonfragment IDs remain distinct while an exact repeated suffix stays raw label provenance',()=>{
  const a=source('Factory Mineral','ITEM-100'),b=source('Factory Mineral','ITEM-1000');
  assert.notEqual(trustedDx5WarningIdentity(a)!.key,trustedDx5WarningIdentity(b)!.key);
  assert.equal(trustedDx5WarningIdentity(a)!.explicitMaterialId,'ITEM-100');assert.equal(compatibleDx5WarningIdentity(a,trustedDx5WarningIdentity(b)!),false);
  const repeatedSuffix=source('Factory Mineral (CODE-A)','CODE-A');assert.equal(trustedDx5WarningIdentity(repeatedSuffix)!.explicitMaterialId,null);assert.equal(trustedDx5WarningIdentity(repeatedSuffix)!.key,trustedDx5WarningIdentity(full())!.key);assert.equal(repeatedSuffix.extractedFacts.warning.materialId,'CODE-A');
});

test('only the original trusted current Dx5 subject can canonicalize a label; no formula or near-name aliases are inferred',()=>{
  for(const patch of [{provider:'MANUAL'},{mailboxConnectionId:null},{subject:'Re: '+subject},{subject:'Inventory Low: Factory\nMineral (CODE-A)'},{extractedFacts:{...full().extractedFacts,warningSource:'OTHER_EMAIL'}},{extractedFacts:{...full().extractedFacts,_provenance:{contentVersion:'SUPPLY_CURRENT_V1',evidenceContext:'ATTACHMENT',productionTeamAuthorized:true}}}])assert.equal(trustedDx5WarningIdentity(source('Factory Mineral','CODE-A',patch)),null);
  const other=source('Mineral','CODE-A',{subject:'Inventory Low: Another Mineral (CODE-A)'});
  assert.notEqual(trustedDx5WarningIdentity(other)!.key,trustedDx5WarningIdentity(split())!.key);
});

function need(id:string,warningSource:ReturnType<typeof source>,when:Date,location='Location unknown',catalogItemId:string|null=null){
  return{id,description:warningSource.extractedFacts.warning.material,location,unit:'units',catalogItemId,createdAt:id==='first'?at(10):at(11),latestWarningAt:when,reportedQuantity:2,reportedThreshold:5,warnings:[{warningAt:when,reportedQuantity:2,reportedThreshold:5,source:warningSource}],audits:[] as Array<{detail:unknown;createdAt:Date;orderId:string}>,allocations:[]};
}
function db(needs:ReturnType<typeof need>[],dismissal=false,catalog:unknown[]=[]){
  return{organization:{findFirst:async()=>({timezone:'America/New_York'})},supplyNeed:{findMany:async(args:{where:{organizationId:string}})=>{assert.equal(args.where.organizationId,'fixture-tenant');return needs;}},supplyCatalogItem:{findMany:async()=>catalog},supplyOrder:{findMany:async()=>[]},supplyAudit:{findMany:async()=>dismissal?[{needId:'second',detail:{cycleKey:supplyStatusKey('second','initial')},createdAt:at(3)}]:[]},user:{findMany:async()=>[]}} as unknown as PrismaClient;
}

test('retained split/full warnings coalesce one cycle with latest alert while source and need history remain unchanged',async()=>{
  const needs=[need('first',split(),at(4)),need('second',full(),at(2))],before=structuredClone(needs);
  const dashboard=await getSupplyStatusDashboard('fixture-tenant',db(needs));
  assert.equal(dashboard.cards.length,1);const card=dashboard.cards[0];assert.equal(card.needId,'first');assert.equal(card.cycleKey,supplyStatusKey('first','initial'));assert.equal(card.warningCount,2);assert.equal(card.lastAlertAt,at(4).toISOString());assert.equal(card.material,'Factory Mineral (CODE-A)');assert.deepEqual(needs,before);
});

test('either retained ingestion order gives one exact-label card and any legacy same-cycle dismissal remains effective',async()=>{
  for(const sources of [[split(),full()],[full(),split()]]){
    const needs=[need('first',sources[0],at(4)),need('second',sources[1],at(2))];
    assert.equal((await getSupplyStatusDashboard('fixture-tenant',db(needs))).cards.length,1);
    assert.equal((await getSupplyStatusDashboard('fixture-tenant',db(needs,true))).cards.length,0);
  }
});

test('known conflicting inventory locations and genuine provider IDs never coalesce by subject alone',async()=>{
  const locations=[need('first',split(),at(4),'Fixture east'),need('second',full(),at(2),'Fixture west')];
  assert.equal((await getSupplyStatusDashboard('fixture-tenant',db(locations))).cards.length,2);
  const ids=[need('first',source('Factory Mineral','ITEM-100'),at(4)),need('second',source('Factory Mineral','ITEM-1000'),at(2))];
  assert.equal((await getSupplyStatusDashboard('fixture-tenant',db(ids))).cards.length,2);
});

test('reviewed catalog identity still unifies confirmed watches and renamed exact Dx5 labels',async()=>{
  const catalog=[{id:'catalog-one',name:'Reviewed material',sharedUse:true,aliases:[{alias:'Factory Mineral (CODE-A)'},{alias:'Renamed provider label'}],rules:[]}];
  const confirmed=need('first',full(),at(1),'Location unknown','catalog-one');confirmed.warnings=[];confirmed.audits=[{detail:{triggerAt:at(1).toISOString(),provenanceVersion:1},createdAt:at(1),orderId:'order'}];
  const renamed=source('Renamed provider label',null,{subject:'Inventory Low: Renamed provider label'});
  const needs=[confirmed,need('second',renamed,at(4),'Location unknown','catalog-one')];
  const client=db(needs,false,catalog),dashboard=await getSupplyStatusDashboard('fixture-tenant',client);
  assert.equal(dashboard.cards.length,1);assert.equal(dashboard.cards[0].needId,'first');assert.equal(dashboard.cards[0].material,'Reviewed material');
  const materials=await getWatchedSupplyMaterials('fixture-tenant',client);assert.equal(materials[0].sharedUse,true);assert.deepEqual(materials[0].needIds,['first','second']);
});

test('the same provider label cannot collapse distinct reviewed catalog identities or shared-use authority',async()=>{
  const catalog=[{id:'catalog-one',name:'Reviewed production material',sharedUse:false,aliases:[{alias:'Factory Mineral (CODE-A)'}],rules:[]},{id:'catalog-two',name:'Reviewed shared material',sharedUse:true,aliases:[{alias:'Factory Mineral (CODE-A)'}],rules:[]}];
  const needs=[need('first',split(),at(4),'Location unknown','catalog-one'),need('second',full(),at(2),'Location unknown','catalog-two')];
  const materials=await getWatchedSupplyMaterials('fixture-tenant',db(needs,false,catalog));
  assert.equal(materials.length,2);assert.deepEqual(materials.map(material=>material.sharedUse).sort(),[false,true]);
});

test('one known provider ID does not defeat a reviewed catalog alias, but conflicting explicit IDs stay separate',async()=>{
  const catalog=[{id:'catalog-one',name:'Reviewed material',sharedUse:false,aliases:[],rules:[]}];
  const known=need('first',source('Factory Mineral','ITEM-100'),at(4),'Location unknown','catalog-one');
  const alias=need('second',full(),at(2),'Location unknown','catalog-one');
  assert.equal((await getSupplyStatusDashboard('fixture-tenant',db([known,alias],false,catalog))).cards.length,1);
  const conflict=need('second',source('Factory Mineral','ITEM-1000'),at(2),'Location unknown','catalog-one');
  assert.equal((await getSupplyStatusDashboard('fixture-tenant',db([known,conflict],false,catalog))).cards.length,2);
});

function ingestFixture(existing:ReturnType<typeof need>[],catalog: Array<{id:string;name:string;sharedUse:boolean;aliases:Array<{alias:string}>}>,legacyOccurrence=false){
  const teamId='11111111-1111-4111-8111-111111111111';
  const preferences={productionSupplies:{productionTeamId:teamId},accountConfiguration:{version:1,territories:[],categories:[],fields:[],teams:[{id:teamId,name:'Production',memberIds:['owner']}]}};
  const sourceRow={id:'replayed-source',extractionStatus:'COMPLETE',...split(),messageDate:at(4),contentHash:'old-content-hash'};
  const rows=existing.map(row=>({...row,reviewRequired:false,resolvedAt:null}));
  const created:Array<Record<string,unknown>>=[],occurrences:Array<Record<string,unknown>>=[];
  const previousOccurrence={needId:existing[0]?.id || 'legacy-need',warningKey:'retained-legacy-raw-key'};
  const tx={
    organization:{findFirst:async()=>({id:'fixture-tenant',crmPreferences:preferences})},
    user:{findFirst:async()=>({id:'owner',role:'ADMIN'})},organizationFeature:{findFirst:async()=>({id:'enabled'})},
    mailboxConnection:{findFirst:async()=>({provider:'GOOGLE',enabled:true,scope:'https://www.googleapis.com/auth/gmail.readonly',accessTokenEncrypted:'supply-v1.sanitized'})},
    $executeRaw:async()=>1,
    supplySource:{findFirst:async()=>structuredClone(sourceRow),update:async({data}:{data:Record<string,unknown>})=>Object.assign(sourceRow,data)},
    supplyCatalogItem:{findMany:async()=>catalog},
    supplyNeed:{
      findUnique:async()=>null,
      findMany:async({where}:{where:{organizationId:string;resolvedAt:unknown;catalogItemId?:string|{not:null}}})=>{
        assert.equal(where.organizationId,'fixture-tenant');
        if(where.resolvedAt!==null)return[];
        return rows.filter(row=>typeof where.catalogItemId==='string'?row.catalogItemId===where.catalogItemId:!where.catalogItemId || Boolean(row.catalogItemId));
      },
      create:async({data}:{data:Record<string,unknown>})=>{created.push(data);return{id:'new-need',...data};},
      update:async({where,data}:{where:{organizationId_id:{id:string}};data:Record<string,unknown>})=>Object.assign(rows.find(row=>row.id===where.organizationId_id.id)!,data),
    },
    supplyWarningOccurrence:{
      findUnique:async()=>null,
      findFirst:async({where}:{where:{organizationId:string;sourceId:string;warningAt:Date}})=>{assert.deepEqual(where,{organizationId:'fixture-tenant',sourceId:'replayed-source',warningAt:at(4)});return legacyOccurrence?previousOccurrence:null;},
      count:async()=>1,
      create:async({data}:{data:Record<string,unknown>})=>{occurrences.push(data);return data;},
    },
    supplyOrderLine:{findMany:async()=>[]},supplyAudit:{create:async()=>({id:'audit'})},
  };
  const client={...tx,$transaction:async(action:(db:typeof tx)=>Promise<unknown>)=>action(tx)} as unknown as PrismaClient;
  const input={source:{provider:'GOOGLE',mailboxConnectionId:'owned-mailbox',messageId:'fixture-message',messageDate:at(4).toISOString(),contentHash:'old-content-hash',subject,extractionStatus:'COMPLETE',contentVersion:'SUPPLY_CURRENT_V1',evidenceContext:'CURRENT_MESSAGE'},evidence:full().extractedFacts};
  return{client,input,sourceRow,created,occurrences,previousOccurrence};
}

test('a repeated exact trusted label retains its unique reviewed catalog mapping without requiring an alias',async()=>{
  const existing=need('reviewed-need',split(),at(2),'Location unknown','reviewed-catalog');
  const fake=ingestFixture([existing],[{id:'reviewed-catalog',name:'Operator-reviewed canonical material',sharedUse:true,aliases:[]}]);
  const result=await ingestEvidence({organizationId:'fixture-tenant',userId:'owner'},fake.input,fake.client,{reconcile:false});
  assert.equal(result.needId,'reviewed-need');assert.equal(fake.created.length,0);assert.equal(fake.occurrences.length,1);
  assert.equal(existing.catalogItemId,'reviewed-catalog');assert.equal(existing.description,'Factory Mineral');
});

test('an exact provider subject cannot choose between distinct existing reviewed catalog mappings',async()=>{
  const rows=[need('reviewed-a',split(),at(2),'Location unknown','catalog-a'),need('reviewed-b',full(),at(2),'Location unknown','catalog-b')];
  const fake=ingestFixture(rows,[{id:'catalog-a',name:'Reviewed first material',sharedUse:false,aliases:[]},{id:'catalog-b',name:'Reviewed shared material',sharedUse:true,aliases:[]}]);
  const result=await ingestEvidence({organizationId:'fixture-tenant',userId:'owner'},fake.input,fake.client,{reconcile:false});
  assert.equal(result.needId,'new-need');assert.equal(fake.created.length,1);assert.equal(fake.created[0].catalogItemId,undefined);
  assert.deepEqual(rows.map(row=>row.catalogItemId),['catalog-a','catalog-b']);
});

test('reprocessing a legacy raw-key warning preserves its occurrence and need after canonical identity enrichment',async()=>{
  const fake=ingestFixture([need('legacy-need',split(),at(4))],[],true);
  const result=await ingestEvidence({organizationId:'fixture-tenant',userId:'owner'},fake.input,fake.client,{reconcile:false});
  assert.equal(result.needId,'legacy-need');assert.equal(fake.created.length,0);assert.equal(fake.occurrences.length,0);
  assert.equal(fake.previousOccurrence.warningKey,'retained-legacy-raw-key');
  const facts=fake.sourceRow.extractedFacts;assert.equal(facts.warning.material,'FACTORY MINERAL (CODE-A)');assert.equal(facts.warning.materialId,null);
});
