import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { acceptWholesaleAssessment } from '../lib/acceptWholesaleAssessment';
import { assessWholesaleAccount } from '../lib/wholesaleAssessment';
import { input } from './fixtures/wholesaleAssessment';
function fixture() {
  const assessment=assessWholesaleAccount(input());
  const row:any={id:'assessment',organizationId:'tenant',wholesaleAccountId:'account',assessment,state:'READY',runId:'run',title:assessment.title,action:assessment.action,priority:assessment.priority,priorityBand:assessment.band};
  let created=0;const events:any[]=[];let task:any,existing:any=null;
  const db:any={
    wholesaleAccountAssessment:{findFirst:async({where}:any)=>where.organizationId===row.organizationId?row:null},
    wholesaleAccount:{findFirst:async()=>({isActive:true,tags:[]})},organizationAccountOverlay:{findFirst:async()=>null},
    user:{findFirst:async({where}:any)=>where.id==='rep'&&where.organizationId==='tenant'?{id:'rep',name:'Rep',email:'rep@example.test'}:null},
    salesOpportunity:{findFirst:async()=>existing,updateMany:async({where}:any)=>{assert.equal(where.organizationId,'tenant');assert.equal(where.actionedAt,null);},create:async({data}:any)=>{created++;existing={...data,id:'pursuit'};return existing;}},
    worklistItem:{create:async({data}:any)=>{task={...data,id:'task'};return task;}},opportunityEvent:{createMany:async({data}:any)=>events.push(...data)},
  };db.$transaction=async(fn:any)=>fn(db);
  const accept=(overrides:any={})=>acceptWholesaleAssessment({db:db as PrismaClient,organizationId:'tenant',id:row.id,candidateKey:assessment.candidates[0].key,actor:{id:'rep',role:'USER'},...overrides});
  return{db,row,events,accept,created:()=>created,task:()=>task};
}
test('explicit acceptance freezes evidence and creates exactly one scoped pursuit/task; repeat acceptance cannot duplicate',async()=>{
  const f=fixture();assert.equal((await f.accept()).taskId,'task');assert.equal(f.created(),1);
  assert.equal(f.task().organizationId,'tenant');assert.equal(f.task().wholesaleAccountId,'account');assert.equal(f.task().salesOpportunityId,'pursuit');
  assert.equal(f.events.filter(e=>e.eventType==='DETECTED').length,1);assert.equal(f.events[0].metadata.modelVersion,'WHOLESALE_ASSESSMENT_V1');
  await assert.rejects(f.accept(),/existing pursuit/);assert.equal(f.created(),1);
});
test('tenant scope, changed candidate, snooze, dismissal, suppression and inactive assignee prevent acceptance',async()=>{
  for(const mode of ['tenant','changed','snooze','dismiss','suppressed','assignee','pending']) {
    const f=fixture();const args:any={};
    if(mode==='tenant')args.organizationId='other';if(mode==='changed')args.candidateKey='changed';
    if(mode==='pending')f.row.refreshRequestedAt=new Date();
    if(mode==='snooze')f.row.snoozedUntil=new Date(Date.now()+86400000);if(mode==='dismiss')f.row.dismissedKey=f.row.assessment.candidates[0].key;
    if(mode==='suppressed')f.db.organizationAccountOverlay.findFirst=async()=>({opportunitySuppressed:true});
    if(mode==='assignee')args.actor={id:'external-user',role:'USER'};
    await assert.rejects(f.accept(args));assert.equal(f.created(),0);
  }
});
