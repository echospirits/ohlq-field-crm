import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateOpportunityIntelligence } from '../lib/opportunityEngine';
import { assessmentDb } from './fixtures/wholesaleAssessmentDb';
test('recalculation persists explicit no-candidate state without changing chosen or historical pursuits',async()=>{
  const f=assessmentDb(1);
  for(const status of ['ACTIONED','SNOOZED','DISMISSED','CONVERTED','RESOLVED']) f.pursuits.push({id:status,wholesaleAccountId:'a0000',status,detectedAt:new Date('2026-01-01'),events:[{metadata:{hypothesis:{targetProduct:{itemCode:'R'}}}}],signalSnapshot:{original:true},title:'Original rum hypothesis'});
  const before=structuredClone(f.pursuits);
  const first=await evaluateOpportunityIntelligence({db:f.db,organizationId:'tenant'});
  const row=f.assessments.get('a0000')!;assert.equal(row.priority,0);assert.equal(row.state,'NEEDS_QUALIFICATION');
  f.assessments.set('a0000',{...row,dismissedKey:'old',dismissalReason:'Timing',snoozedUntil:'2027-01-01'});
  await evaluateOpportunityIntelligence({db:f.db,organizationId:'tenant'});
  assert.equal(f.assessments.size,1);assert.equal(f.assessments.get('a0000')!.dismissedKey,'old');assert.equal(f.assessments.get('a0000')!.snoozedUntil,'2027-01-01');
  assert.deepEqual(f.pursuits,before);assert.equal(first.worklistCreated,0);assert.equal(first.detected,0);assert.equal(first.converted,0);
  assert.equal(f.pursuitWrites.length,0,'unavailable sales must not create outcome labels');
});
