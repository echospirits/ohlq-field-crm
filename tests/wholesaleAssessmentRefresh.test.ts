import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWholesaleAssessments } from '../lib/wholesaleAssessmentService';
import { aggregatePurchases } from '../lib/wholesaleAssessmentInputs';
import { sourceCoverage } from '../lib/wholesaleAssessmentCoverage';
import { assessmentDb } from './fixtures/wholesaleAssessmentDb';

test('committed zero day, same-date corrections and retries replace ledger atomically without double counting', async () => {
  const f = assessmentDb(1), day = new Date(); day.setUTCDate(day.getUTCDate()-1); day.setUTCHours(0,0,0,0);
  const report = { id:'report', reportDate:day, updatedAt:new Date(), rowCount:0, status:'COMPLETED' };
  let raw: any[] = [], events: any[] = [], checkpoint: any = null, deletes = 0;
  f.raw.ohlqReportImportStatus = { findFirst:async()=>report, findMany:async()=>[report], findUnique:async()=>report };
  f.raw.wholesaleSalesLedgerDay = { findMany:async()=>checkpoint?[checkpoint]:[], upsert:async({create,update}:any)=>{ checkpoint=checkpoint?{...checkpoint,...update}:create; } };
  f.raw.ohlqAnnualSalesByWholesaleRow.findMany=async()=>raw;
  f.raw.accountSalesEvent = { findMany:async()=>events, deleteMany:async({where}:any)=>{assert.equal(where.organizationId,'tenant');events=[];deletes++;}, createMany:async({data}:any)=>{events.push(...data);} };
  await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',reconcileLedger:true});
  assert.equal(checkpoint.sourceRows,0); assert.equal(events.length,0); assert.equal(f.runs[0].status,'PARTIAL_SOURCE');
  assert.equal((f.assessments.get('a0000')!.assessment as any).coverage.completeDays,1);
  assert.equal((f.assessments.get('a0000')!.assessment as any).coverage.verifiedZero,false);
  report.rowCount=1; report.updatedAt=new Date(report.updatedAt.getTime()+1);
  raw=[{reportDate:day,permitNumber:'10000',agencyId:'A',vendor:'V',brand:'R',wholesaleBottlesSold:4}];
  await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',reconcileLedger:true});
  assert.equal(events.length,1); assert.equal(events[0].bottles,4); assert.equal(deletes,2);
  await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',reconcileLedger:true});
  assert.equal(events.length,1); assert.equal(deletes,2); assert.equal(f.assessments.size,1);
  raw=[];report.rowCount=0;report.updatedAt=new Date(report.updatedAt.getTime()+1);
  await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',reconcileLedger:true});
  assert.equal(events.length,0);assert.equal(deletes,3);
});

test('uncommitted and pruned/mismatched report rows never certify zero or discard prior ledger',async()=>{
  const f=assessmentDb(1);const report={id:'r',reportDate:new Date(),updatedAt:new Date(),rowCount:5,status:'COMPLETED'};
  let deletes=0,certified=0;
  f.raw.ohlqReportImportStatus={findFirst:async()=>report,findMany:async()=>[report],findUnique:async()=>report};
  f.raw.accountSalesEvent.deleteMany=async()=>{deletes++;};f.raw.wholesaleSalesLedgerDay.upsert=async()=>{certified++;};
  await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',reconcileLedger:true});
  assert.equal(certified,0);assert.equal(deletes,0);
  report.status='RUNNING';
  await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',reconcileLedger:true});
  assert.equal(certified,0);assert.equal(deletes,0);
});

test('historical backfill captures requested history without moving the current window backward',async()=>{
  const f=assessmentDb(1);let where:any;
  f.raw.ohlqReportImportStatus.findMany=async(args:any)=>{where=args.where;return[];};
  const result=await evaluateWholesaleAssessments({db:f.db,organizationId:'tenant',asOfDate:new Date('2025-01-01'),dryRun:true});
  assert.equal(where.reportDate.gte.toISOString().slice(0,10),'2025-01-01');
  assert.ok(result.previews[0].assessment.asOf > '2025-01-01');
});

test('existing purchases age out of 30, 60 and 90 day windows without new imports',()=>{
  const event={itemCode:'R',itemName:'Rum',category:'RUM',bottles:6,reportDate:new Date('2026-06-01')};
  const at=(date:string)=>aggregatePurchases([event],new Map(),new Set(),new Date(date));
  assert.equal(at('2026-06-30')[0].bottles30,6);assert.equal(at('2026-07-01')[0].bottles30,0);
  assert.equal(at('2026-07-30')[0].bottles60,6);assert.equal(at('2026-07-31')[0].bottles60,0);
  assert.equal(at('2026-08-29')[0].bottles90,6);assert.equal(at('2026-08-30').length,0);
});

test('unmatched location uses research regardless of statewide sales coverage',()=>{
  const coverage=sourceCoverage({asOf:new Date('2026-09-28'),completeDates:new Set(['2026-09-28']),identity:'UNMATCHED',hasPurchases:false,through:'2026-09-28'});
  assert.equal(coverage.mode,'RESEARCH_ONLY');assert.equal(coverage.verifiedZero,false);assert.match(coverage.limitations.join(' '),/unmatched/);
});
