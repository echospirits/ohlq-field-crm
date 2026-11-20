import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWholesaleAssessments, markWholesaleAssessmentSourceFailure } from '../lib/wholesaleAssessmentService';
import { aggregatePurchases } from '../lib/wholesaleAssessmentInputs';
import { sourceCoverage, representedWindow, windowDates } from '../lib/wholesaleAssessmentCoverage';
import { assessmentDb } from './fixtures/wholesaleAssessmentDb';

test('committed zero day, same-date corrections and retries replace ledger atomically without double counting', async () => {
  const f = assessmentDb(1), day = new Date(); day.setUTCDate(day.getUTCDate()-1); day.setUTCHours(0,0,0,0);
  const report = { id:'report', reportDate:day, updatedAt:new Date(), rowCount:0, status:'COMPLETED' };
  let raw: any[] = [], events: any[] = [], checkpoint: any = null, deletes = 0;
  f.raw.ohlqReportImportStatus = { findFirst:async()=>report, findMany:async()=>[report], findUnique:async()=>report };
  f.raw.wholesaleSalesLedgerDay = { findMany:async()=>checkpoint?[checkpoint]:[], upsert:async({create,update}:any)=>{ checkpoint=checkpoint?{...checkpoint,...update}:create; } };
  f.raw.ohlqAnnualSalesByWholesaleRow.findMany=async()=>raw;
  f.raw.accountSalesEvent = { findMany:async()=>events, deleteMany:async({where}:any)=>{assert.equal(where.organizationId,'org_echo_spirits');events=[];deletes++;}, createMany:async({data}:any)=>{events.push(...data);} };
  await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',reconcileLedger:true});
  assert.equal(checkpoint.sourceRows,0); assert.equal(events.length,0); assert.equal(f.runs[0].status,'COMPLETED');
  assert.equal((f.assessments.get('a0000')!.assessment as any).coverage.completeDays,1);
  assert.equal((f.assessments.get('a0000')!.assessment as any).coverage.verifiedZero,true);
  report.rowCount=1; report.updatedAt=new Date(report.updatedAt.getTime()+1);
  raw=[{reportDate:day,permitNumber:'10000',agencyId:'A',vendor:'V',brand:'R',wholesaleBottlesSold:4}];
  await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',reconcileLedger:true});
  assert.equal(events.length,1); assert.equal(events[0].bottles,4); assert.equal(deletes,2);
  await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',reconcileLedger:true});
  assert.equal(events.length,1); assert.equal(deletes,2); assert.equal(f.assessments.size,1);
  raw=[];report.rowCount=0;report.updatedAt=new Date(report.updatedAt.getTime()+1);
  await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',reconcileLedger:true});
  assert.equal(events.length,0);assert.equal(deletes,3);
});

test('uncommitted and pruned/mismatched report rows never certify zero or discard prior ledger',async()=>{
  const f=assessmentDb(1);const report={id:'r',reportDate:new Date(),updatedAt:new Date(),rowCount:5,status:'COMPLETED'};
  let deletes=0,certified=0;
  f.raw.ohlqReportImportStatus={findFirst:async()=>report,findMany:async()=>[report],findUnique:async()=>report};
  f.raw.accountSalesEvent.deleteMany=async()=>{deletes++;};f.raw.wholesaleSalesLedgerDay.upsert=async()=>{certified++;};
  await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',reconcileLedger:true});
  assert.equal(certified,0);assert.equal(deletes,0);
  report.status='RUNNING';
  await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',reconcileLedger:true});
  assert.equal(certified,0);assert.equal(deletes,0);
});

test('an old Echo-only raw subset cannot replace a complete statewide ledger or certify a revised receipt', async () => {
  const f = assessmentDb(1);
  const day = new Date(); day.setUTCDate(day.getUTCDate() - 40); day.setUTCHours(0, 0, 0, 0);
  const previousRevision = new Date(day.getTime() + 1_000);
  const report = { id: 'old-report', reportDate: day, updatedAt: new Date(day.getTime() + 2_000), rowCount: 2, skippedRows: 0, status: 'COMPLETED' };
  const checkpoint = { organizationId: 'org_echo_spirits', reportDate: day, sourceRows: 2, sourceRevision: `${previousRevision.toISOString()}:2` };
  const events = [
    { wholesaleAccountId: 'a0000', reportDate: day, itemCode: 'R', itemName: 'Echo Rum', category: 'RUM', vendor: 'Z90399001', bottles: 4 },
    { wholesaleAccountId: 'a0000', reportDate: day, itemCode: 'OTHER', itemName: 'Other Rum', category: 'RUM', vendor: 'OTHER', bottles: 6 },
  ];
  const original = structuredClone({ checkpoint, events });
  let rawReads = 0;
  f.raw.ohlqReportImportStatus = { findFirst: async () => report, findMany: async () => [report], findUnique: async () => report };
  f.raw.wholesaleSalesLedgerDay = {
    findMany: async () => [checkpoint],
    upsert: async () => assert.fail('a vendor-only remainder must not certify a statewide receipt'),
  };
  f.raw.ohlqAnnualSalesByWholesaleRow.findMany = async () => {
    rawReads++;
    return [{ reportDate: day, permitNumber: '10000', agencyId: 'A', vendor: 'Z90399001', brand: 'R', wholesaleBottlesSold: 4 }];
  };
  f.raw.accountSalesEvent = {
    findMany: async () => events,
    deleteMany: async () => assert.fail('retention must not discard the complete captured ledger'),
    createMany: async () => assert.fail('a partial retained report must not replace captured events'),
  };

  await evaluateWholesaleAssessments({ db: f.db, organizationId: 'org_echo_spirits', asOfDate: day, reconcileLedger: true });

  assert.equal(rawReads, 1, 'the revised receipt must be checked against its retained rows');
  assert.deepEqual({ checkpoint, events }, original);
  assert.equal((f.runs[0].sourceCoverage as { completeDays: number }).completeDays, 0);
});

test('historical backfill captures requested history without moving the current window backward',async()=>{
  const f=assessmentDb(1);let where:any;
  f.raw.ohlqReportImportStatus.findMany=async(args:any)=>{where=args.where;return[];};
  const result=await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',asOfDate:new Date('2025-01-01'),dryRun:true});
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

test('longest complete represented block wins, equal durations prefer newest and account purchase dates are irrelevant', () => {
  const asOf = new Date('2026-10-09');
  const days = new Set([...windowDates(new Date('2026-09-26'),18), ...windowDates(new Date('2026-10-03'),6), ...windowDates(asOf,5)]);
  assert.deepEqual({ ...representedWindow(asOf, days), dates: undefined }, { from:'2026-09-09', through:'2026-09-26', days:18, dates:undefined });
  const coverage = sourceCoverage({ asOf, completeDates:days, identity:'MATCHED', hasPurchases:false, through:'2026-10-09' });
  assert.equal(coverage.mode,'SALES_BACKED');assert.equal(coverage.completeDays,18);assert.equal(coverage.expectedDays,18);assert.equal(coverage.verifiedZero,true);
  assert.equal(representedWindow(asOf,new Set([...windowDates(new Date('2026-09-26'),5),...windowDates(asOf,5)])).through,'2026-10-09');
  assert.equal(representedWindow(new Date('2027-02-01'),days).days,0,'old source days age out instead of becoming permanent annual history');
});

test('complete 30-day coverage persists rated zero separately from unrated and snapshots every successful run',async()=>{
  const f=assessmentDb(2), day=new Date();day.setUTCDate(day.getUTCDate()-1);day.setUTCHours(0,0,0,0);
  const reports=windowDates(day,30).map((date,i)=>({id:`r${i}`,reportDate:new Date(date),updatedAt:new Date('2026-01-01'),rowCount:0,status:'COMPLETED',skippedRows:0}));
  f.raw.ohlqReportImportStatus={findFirst:async()=>reports[0],findMany:async()=>[...reports].reverse()};
  f.raw.wholesaleSalesLedgerDay.findMany=async()=>reports.map(r=>({reportDate:r.reportDate,sourceRevision:`${r.updatedAt.toISOString()}:0`}));
  f.raw.organizationProduct.findMany=async()=>[{id:'p',externalItemCode:'R',market:'OH',active:true,discontinued:false,status:'OWNED',displayName:'Light Rum',category:'Rum',subcategory:'light'}];
  f.raw.ohlqBrandMasterItem.findMany=async()=>[{itemCode:'R',name:'Light Rum',category:'Rum',productVolume:25.4,wholesalePrice:25,retailPrice:27,solItemStatusCode:'70'}];
  const r=await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits'});
  assert.equal(r.persisted,2);assert.equal(r.sourceBlocked,0);assert.equal(f.assessments.get('a0000')!.rating,0);assert.equal(f.assessments.get('a0000')!.assessmentStatus,'READY');
  assert.equal(f.assessments.get('a0001')!.rating,null);assert.equal(f.assessments.get('a0001')!.assessmentStatus,'UNRATED');
  assert.equal((f.assessments.get('a0000')!.assessment as any).commercial.representedDays,30);
  assert.equal(f.snapshots.size,2);
  const old=structuredClone(f.assessments.get('a0000')!);Object.assign(f.assessments.get('a0000')!,{dismissedKey:'account:a0000',snoozedUntil:'2027-01-01'});
  const newest={...reports[0],status:'ERRORED',updatedAt:new Date('2026-01-02')};
  f.raw.ohlqReportImportStatus.findMany=async()=>[...reports.slice(1).reverse(),newest];
  const blocked=await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits'});
  const preserved=f.assessments.get('a0000')!;
  assert.equal(blocked.skipped,1);assert.equal(blocked.persisted,1);assert.equal(blocked.sourceBlocked,1);assert.equal(f.runs[1].status,'SOURCE_ERROR');
  assert.equal(preserved.rating,0);assert.deepEqual(preserved.assessment,old.assessment);assert.equal(preserved.calculatedAt,old.calculatedAt);assert.equal(preserved.assessmentStatus,'SOURCE_ERROR');
  assert.equal(preserved.dismissedKey,'account:a0000');assert.equal(preserved.snoozedUntil,'2027-01-01');
  f.raw.ohlqReportImportStatus.findMany=async()=>[...reports].reverse();
  const recovered=await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits'});
  assert.equal(recovered.persisted,2);assert.equal(recovered.sourceBlocked,0);assert.equal(f.assessments.get('a0000')!.assessmentStatus,'READY');
  assert.equal(f.snapshots.size,5,'failure preserves old snapshot, research account still receives its own result');
});

test('failed historical backfill does not mark a newer current source failed and failure marking does not rewrite ratings',async()=>{
  const f=assessmentDb(1);
  f.assessments.set('a0000',{organizationId:'org_echo_spirits',rating:5,assessment:{original:true},evidenceMode:'SALES_BACKED'});
  f.raw.ohlqReportImportStatus.findFirst=async()=>({reportDate:new Date('2026-10-09')});
  assert.deepEqual(await markWholesaleAssessmentSourceFailure({db:f.db,reportDate:new Date('2026-09-01')}),{count:0});
  assert.equal(f.assessments.get('a0000')!.assessmentStatus,undefined);
  await markWholesaleAssessmentSourceFailure({db:f.db,reportDate:new Date('2026-10-09')});
  assert.equal(f.assessments.get('a0000')!.assessmentStatus,'SOURCE_ERROR');assert.equal(f.assessments.get('a0000')!.rating,5);
  assert.deepEqual(f.assessments.get('a0000')!.assessment,{original:true});
});

test('a non-Ohio location with explicitly linked certified sales uses actual source availability',async()=>{
  const f=assessmentDb(2), day=new Date();day.setUTCDate(day.getUTCDate()-1);day.setUTCHours(0,0,0,0);
  const report={id:'r',reportDate:day,updatedAt:new Date('2026-01-01'),rowCount:1,status:'COMPLETED',skippedRows:0};
  f.raw.ohlqReportImportStatus={findFirst:async()=>report,findMany:async()=>[report]};
  f.raw.wholesaleSalesLedgerDay.findMany=async()=>[{reportDate:day,sourceRevision:`${report.updatedAt.toISOString()}:1`}];
  f.raw.accountSalesEvent.findMany=async()=>[{wholesaleAccountId:'a0001',itemCode:'R',itemName:'Light Rum',category:'Rum',bottles:24,reportDate:day}];
  f.raw.organizationProduct.findMany=async()=>[{id:'p',externalItemCode:'R',market:'OH',active:true,discontinued:false,status:'OWNED',displayName:'Light Rum',category:'Rum',subcategory:'light'}];
  f.raw.ohlqBrandMasterItem.findMany=async()=>[{itemCode:'R',name:'Light Rum',category:'Rum',productVolume:25.4,wholesalePrice:25,retailPrice:27,solItemStatusCode:'70'}];
  const result=await evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits',dryRun:true});
  const account=result.previews.find(p=>p.accountId==='a0001')!;
  assert.equal(account.assessment.evidenceMode,'SALES_BACKED');assert.equal(account.input.coverage.identity,'MATCHED');assert.equal(account.assessment.observed.bottles90,24);
  assert.ok(account.assessment.rating!==null && account.assessment.rating>0);
});

test('a same-date source revision arriving after input reads prevents publication and marks cached results stale',async()=>{
  const f=assessmentDb(1), day=new Date();day.setUTCDate(day.getUTCDate()-1);day.setUTCHours(0,0,0,0);
  f.assessments.set('a0000',{organizationId:'org_echo_spirits',rating:4,evidenceMode:'SALES_BACKED',assessment:{coverage:{identity:'MATCHED'},original:true},calculatedAt:'2026-01-01'});
  const report={id:'r',reportDate:day,updatedAt:new Date('2026-01-01'),rowCount:1,status:'COMPLETED',skippedRows:0};
  let reads=0;
  f.raw.ohlqReportImportStatus={findFirst:async()=>report,findMany:async()=>[{...report,updatedAt:++reads===1?report.updatedAt:new Date('2026-01-02')}]};
  f.raw.wholesaleSalesLedgerDay.findMany=async()=>[{reportDate:day,sourceRevision:`${report.updatedAt.toISOString()}:1`}];
  await assert.rejects(evaluateWholesaleAssessments({db:f.db,organizationId:'org_echo_spirits'}),/source changed while scoring/);
  assert.equal(f.snapshots.size,0);assert.equal(f.assessments.get('a0000')!.rating,4);assert.equal(f.assessments.get('a0000')!.calculatedAt,'2026-01-01');
  assert.equal(f.assessments.get('a0000')!.assessmentStatus,'SOURCE_ERROR');assert.equal(f.runs[0].status,'FAILED');assert.equal(f.runs[0].persisted,0);
});
