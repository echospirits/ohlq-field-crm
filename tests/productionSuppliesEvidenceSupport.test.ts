import assert from 'node:assert/strict';
import test from 'node:test';
import type {Prisma} from '@prisma/client';
import {quarantineUnsupportedSupplyOrders} from '../lib/productionSupplies/evidenceSupport';

const meta={contentVersion:'SUPPLY_CURRENT_V1',evidenceContext:'CURRENT_MESSAGE'};
function fixture(facts:Record<string,unknown>,patch:Record<string,unknown>={}){
  const changes:unknown[]=[];
  const order={id:'order-a',supplier:'Fixture supplier',orderReference:'TEST-A',destination:'Fixture production',manualFields:[],ignored:false,lines:[{description:'Cane sugar',sku:'TEST100',unit:'bags',manualFields:[],manualClassification:false}],sources:[{source:{provider:'GOOGLE',userId:'owner',mailboxConnectionId:'mailbox',extractionStatus:'COMPLETE',extractedFacts:{kind:'ORDER',supplier:'Fixture supplier',destination:'Fixture production',...facts,_provenance:meta}}}],shipments:[],receipts:[],...patch};
  const tx={supplyOrder:{findMany:async()=>[order],update:async(value:unknown)=>{changes.push(value);return order;}},supplyAudit:{create:async()=>({id:'audit'}),findFirst:async()=>({id:'prior-automatic-quarantine'})}};
  return{tx:tx as unknown as Prisma.TransactionClient,changes};
}
test('a corrected current purchase cannot support a different old reference with the same material SKU',async()=>{
  const fake=fixture({orderReference:'TEST-B',lines:[{description:'Cane sugar',sku:'TEST100',unit:'bags'}]});
  assert.deepEqual(await quarantineUnsupportedSupplyOrders(fake.tx,'tenant','owner','source'),['order-a']);
  assert.equal(fake.changes.length,1);
});
test('conflicting known supplier or raw unit does not preserve an unsupported legacy match',async()=>{
  for(const facts of [{supplier:'Different supplier',orderReference:'TEST-A',lines:[{description:'Cane sugar',sku:'TEST100',unit:'bags'}]},{lines:[{description:'Cane sugar',sku:'TEST100',unit:'pallets'}]}]){
    const fake=fixture(facts);assert.deepEqual(await quarantineUnsupportedSupplyOrders(fake.tx,'tenant','owner','source'),['order-a']);
  }
});
test('a prior human receipt is independent evidence and automatic correction cannot hide that purchase',async()=>{
  const fake=fixture({kind:'OTHER'},{receipts:[{id:'human-receipt'}]});
  assert.deepEqual(await quarantineUnsupportedSupplyOrders(fake.tx,'tenant','owner','source'),[]);assert.equal(fake.changes.length,0);
});
test('current evidence may restore automatic quarantine but never an explicit manual ignore',async()=>{
  const support={orderReference:'TEST-A',lines:[{description:'Cane sugar',sku:'TEST100',unit:'bags'}]};
  const automatic=fixture(support,{ignored:true});await quarantineUnsupportedSupplyOrders(automatic.tx,'tenant','owner','source',{quarantine:false,restore:true});assert.equal(automatic.changes.length,1);
  const manual=fixture(support,{ignored:true,manualFields:['ignored']});await quarantineUnsupportedSupplyOrders(manual.tx,'tenant','owner','source',{quarantine:false,restore:true});assert.equal(manual.changes.length,0);
});
