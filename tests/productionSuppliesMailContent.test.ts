import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { currentPlainText, prepareSupplyMessageContent, supplyMessageSender, type GmailPart } from '../lib/productionSupplies/mailContent';
import { buildSupplyIncrementalQuery, buildSupplyPriorityQueries, chooseSupplyMailLane, completeSupplyMailLane, supplyHistoricalComplete, supplyMailCursor, supplyMailDiscovery } from '../lib/productionSupplies/mailDiscovery';
const body=(text:string)=>({data:Buffer.from(text).toString('base64url')});
const image=(index:number):GmailPart=>({filename:`image${String(index).padStart(3,'0')}.png`,mimeType:'image/png',headers:[{name:'Content-ID',value:`<sig-${index}>`},{name:'Content-Disposition',value:'inline'}],body:{attachmentId:`image-id-${index}`,size:2000}});
test('quoted signature images never consume the document limit or repeat an old purchase as current evidence',()=>{
  const logos=Array.from({length:16},(_,i)=>image(i));
  const html='<p>We will pay next Monday; please wait for payment.</p><div class="gmail_quote"><p>Old order, old ETA, old quantities.</p>'+logos.map((_,i)=>`<img src="cid:sig-${i}">`).join('')+'</div>';
  const prepared=prepareSupplyMessageContent({mimeType:'multipart/mixed',parts:[{mimeType:'text/html',body:body(html)},...logos,{filename:'current-proforma.pdf',mimeType:'application/pdf',body:{attachmentId:'real-pdf',size:120000}}]});
  assert.match(prepared.text,/pay next Monday/);assert.doesNotMatch(prepared.text,/Old order|old ETA|old quantities/);
  assert.equal(prepared.ignoredInlineImages,16);assert.equal(prepared.attachments.length,1);assert.equal(prepared.attachments[0].body?.attachmentId,'real-pdf');
});
test('plain reply boundaries and quoted lines preserve only the current author event',()=>{
  assert.equal(currentPlainText('Current reply.\n\nOn Mon, Nov 2, 2026, Buyer\n<buyer@fixture.invalid> wrote:\nOld order'), 'Current reply.');
  assert.equal(currentPlainText('Current reply.\nFrom: Buyer\nSent: Monday\nTo: Supplier\nOld order'),'Current reply.');
  assert.equal(currentPlainText('Current reply.\n> Old delivery\n-- \nSignature'),'Current reply.');
});
test('real image invoices, document photos and PDFs remain eligible while decorative pixels are skipped',()=>{
  const result=prepareSupplyMessageContent({parts:[{mimeType:'text/html',body:body('<p>Attached invoice</p><img src="cid:invoice"><img src="cid:logo">')},{filename:'invoice-scan.png',mimeType:'image/png',headers:[{name:'Content-ID',value:'<invoice>'},{name:'Content-Disposition',value:'inline'}],body:{attachmentId:'invoice',size:100000}},{filename:'photo.jpg',mimeType:'image/jpeg',headers:[{name:'Content-Disposition',value:'attachment'}],body:{attachmentId:'photo',size:150000}},{filename:'logo.png',mimeType:'image/png',headers:[{name:'Content-ID',value:'<logo>'}],body:{attachmentId:'logo',size:1000}}]});
  assert.deepEqual(result.attachments.map(p=>p.body?.attachmentId),['invoice','photo']);assert.equal(result.ignoredInlineImages,1);
});
test('HTML signatures, scripts and Outlook reply history cannot become current facts',()=>{
  const result=prepareSupplyMessageContent({mimeType:'text/html',body:body('<div>Received your message &amp; will review.</div><div class="gmail_signature">Old product signature</div><script>Old tracking</script><div id="divRplyFwdMsg">From: Old supplier</div><div>Delivered yesterday.</div>')});
  assert.equal(result.text,'Received your message & will review.');
});
test('received Production sender attestation requires aligned Google authentication; sent mail requires the mailbox owner',()=>{
  const headers=[{name:'From',value:'Fixture colleague <buyer@fixture.invalid>'},{name:'Authentication-Results',value:'mx.google.com; dkim=pass header.i=@fixture.invalid; dmarc=none header.from=fixture.invalid'}];
  assert.deepEqual(supplyMessageSender(headers,false),{fromEmail:'buyer@fixture.invalid',senderAuthenticated:true});
  assert.deepEqual(supplyMessageSender([{...headers[0]},{...headers[1],value:'mx.google.com; dkim=pass header.d=attacker.invalid'}],false),{});
  assert.deepEqual(supplyMessageSender([{...headers[0]},{...headers[1],value:'mx.google.com; dkim=fail (header.d=fixture.invalid; dkim=pass header.d=fixture.invalid)'}],false),{});
  assert.deepEqual(supplyMessageSender(headers,true,'different@fixture.invalid'),{});
  assert.equal(supplyMessageSender(headers,true,'buyer@fixture.invalid').senderAuthenticated,true);
});
const now=new Date('2026-11-12T12:00:00Z'),context={memberEmails:['buyer@fixture.invalid'],materials:['Fixture raisins'],orderReferences:['PO-42']};
const queries=buildSupplyPriorityQueries(new Date('2026-08-14T00:00:00Z'),true,context);
test('priority discovery is tenant-member/material specific and never loses a pre-existing broad checkpoint',()=>{
  const legacy={query:'original-query',pageToken:'original-token',scanStarted:'2026-11-12T11:00:00.000Z',messageIds:['message-a','message-b'],messageIndex:1,nextPageToken:'next-token'};
  const cursor=supplyMailCursor(legacy,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'new-query',priorityQueries:queries});
  assert.deepEqual(cursor.scans.BROAD,legacy);assert.equal(chooseSupplyMailLane(cursor,now,15),'DX5');
  cursor.completed.push('DX5');cursor.turn=1;assert.equal(chooseSupplyMailLane(cursor,now,15),'PRODUCTION_ORDERS');
  assert.match(queries.PRODUCTION_ORDERS,/buyer@fixture.invalid/);assert.match(queries.PRODUCTION_ORDERS,/filename:pdf.*proforma/);assert.match(queries.MATERIALS!,/Fixture raisins.*PO-42/);
  assert.deepEqual(legacy.messageIds,['message-a','message-b']);
});
test('incremental discovery stays due every15minutes while historical catch-up remains incomplete',()=>{
  const cursor=supplyMailCursor(null,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'broad',priorityQueries:queries});
  assert.equal(chooseSupplyMailLane(cursor,new Date(now.getTime()+14*60_000),15),'DX5');
  assert.equal(chooseSupplyMailLane(cursor,new Date(now.getTime()+15*60_000),15),'INCREMENTAL');
  assert.equal(cursor.scans.BROAD?.query,'broad');
});
test('an in-progress legacy incremental checkpoint survives upgrade after historical completion',()=>{
  const legacy={query:'incremental-original',scanStarted:now.toISOString(),pageToken:'incremental-position',messageIds:['original-message'],messageIndex:0};
  const cursor=supplyMailCursor(legacy,{now,backfillComplete:true,lastSuccessfulSyncAt:now,broadQuery:'new-broad',priorityQueries:queries});
  assert.equal(cursor.scans.BROAD,null);assert.deepEqual(cursor.incremental,legacy);assert.equal(chooseSupplyMailLane(cursor,now,15),'INCREMENTAL');
});
test('a genuine large inline invoice image with a generic filename remains eligible',()=>{
  const prepared=prepareSupplyMessageContent({parts:[{filename:'image001.jpg',mimeType:'image/jpeg',headers:[{name:'Content-ID',value:'<scan-one>'}],body:{attachmentId:'original-scan',size:150000}}]},'Scanned invoice');
  assert.equal(prepared.attachments[0]?.body?.attachmentId,'original-scan');assert.equal(prepared.ignoredInlineImages,0);
});
test('unknown checkpoint formats fail without restarting or dropping the stored cursor',()=>{
  assert.throws(()=>supplyMailCursor({version:999,opaque:'saved-position'},{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'broad',priorityQueries:queries}),/unsupported/);
});
test('incremental queries include known materials and order references even without generic supply words',()=>{
  const query=buildSupplyIncrementalQuery('(invoice OR shipment) after:1',queries);
  assert.match(query,/Fixture raisins/);assert.match(query,/PO-42/);assert.match(query,/from:no-reply@fx5.com/);assert.match(query,/buyer@fixture.invalid/);
});
test('uncatalogued Dx5 materials feed priority discovery without requiring catalog identity',async()=>{
  const seen:unknown[]=[];
  const db={
    user:{findMany:async(args:unknown)=>{seen.push(args);return[{email:'buyer@fixture.invalid'}];}},
    supplyCatalogItem:{findMany:async(args:unknown)=>{seen.push(args);return[];}},
    supplyOrder:{findMany:async(args:unknown)=>{seen.push(args);return[];}},
    supplyNeed:{findMany:async(args:unknown)=>{seen.push(args);return[{id:'warning-one',description:'Fixture glass bottles',catalogItemId:null,location:'Location unknown',unit:'ea',createdAt:now,latestWarningAt:now,warnings:[{warningAt:now,reportedQuantity:1,reportedThreshold:10,source:{extractedFacts:{kind:'WARNING',warningSource:'DISTILLX5_EMAIL'}}}]}];}},
  } as unknown as PrismaClient;
  const discovery=await supplyMailDiscovery('tenant-one',{},db);
  assert.ok(discovery.materials.includes('Fixture glass bottles'));
  assert.ok(seen.every(args=>(args as {where:{organizationId:string}}).where.organizationId==='tenant-one'));
});
test('a newly confirmed material reopens targeted history after its empty lane completed without resetting broad history',()=>{
  const initial=buildSupplyPriorityQueries(new Date('2026-08-14T00:00:00Z'),true,{memberEmails:[],materials:[],orderReferences:[]});
  const cursor=supplyMailCursor(null,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'frozen-broad',priorityQueries:initial});
  cursor.scans.BROAD={query:'frozen-broad',pageToken:'original-page',scanStarted:now.toISOString(),messageIds:['retained-message'],messageIndex:1};
  const broad=structuredClone(cursor.scans.BROAD);
  const updated=supplyMailCursor(cursor,{now:new Date(now.getTime()+60_000),backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'must-not-replace',priorityQueries:queries});
  assert.deepEqual(updated.scans.BROAD,broad);assert.match(updated.scans.MATERIALS!.query,/Fixture raisins.*PO-42/);
  assert.equal(updated.completed.includes('MATERIALS'),false);assert.equal(chooseSupplyMailLane(updated,new Date(now.getTime()+60_000),15),'MATERIALS');
});
test('completed targeted history reopens for a new order reference after all historical lanes finished',()=>{
  const cursor=supplyMailCursor(null,{now,backfillComplete:true,lastSuccessfulSyncAt:now,broadQuery:'unused-broad',priorityQueries:queries});
  for(const lane of ['DX5','PRODUCTION_ORDERS','MATERIALS'] as const){cursor.scans[lane]=null;completeSupplyMailLane(cursor,lane);}
  assert.equal(supplyHistoricalComplete(cursor),true);
  const changed=buildSupplyPriorityQueries(new Date('2026-08-14T00:00:00Z'),true,{...context,orderReferences:['PO-42','PO-43']});
  const updated=supplyMailCursor(cursor,{now,backfillComplete:true,lastSuccessfulSyncAt:now,broadQuery:'unused-new',priorityQueries:changed});
  assert.equal(updated.scans.BROAD,null);assert.equal(updated.completed.includes('BROAD'),true);assert.equal(supplyHistoricalComplete(updated),false);assert.match(updated.scans.MATERIALS!.query,/PO-43/);
});
test('new material scope queues behind an active targeted page and promotes after that exact checkpoint completes',()=>{
  const cursor=supplyMailCursor(null,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'frozen-broad',priorityQueries:queries});
  cursor.scans.MATERIALS={query:queries.MATERIALS!,pageToken:'retained-page',scanStarted:now.toISOString(),messageIds:['original-a','original-b'],messageIndex:1,nextPageToken:'retained-next'};
  const retained=structuredClone(cursor.scans.MATERIALS);
  const changed=buildSupplyPriorityQueries(new Date('2026-08-14T00:00:00Z'),true,{...context,materials:[...context.materials,'Fixture new sugar']});
  const updated=supplyMailCursor(cursor,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'ignored',priorityQueries:changed});
  assert.deepEqual(updated.scans.MATERIALS,retained);assert.match(updated.pendingMaterials!.scan!.query,/Fixture new sugar/);
  updated.scans.MATERIALS=null;completeSupplyMailLane(updated,'MATERIALS');
  assert.match(updated.scans.MATERIALS!.query,/Fixture new sugar/);assert.equal(updated.pendingMaterials,null);assert.equal(updated.completed.includes('MATERIALS'),false);
});
test('moving catch-up date, unchanged matching terms and removed pending scope never restart or replace an active page',()=>{
  const cursor=supplyMailCursor(null,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'frozen-broad',priorityQueries:queries});
  cursor.scans.MATERIALS={query:queries.MATERIALS!,pageToken:'active-page',scanStarted:now.toISOString()};
  const retained=structuredClone(cursor.scans.MATERIALS);
  const reordered=buildSupplyPriorityQueries(new Date('2026-08-15T00:00:00Z'),true,{...context,materials:[...context.orderReferences],orderReferences:[...context.materials]});
  let updated=supplyMailCursor(cursor,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'ignored',priorityQueries:reordered});
  assert.deepEqual(updated.scans.MATERIALS,retained);assert.equal(updated.pendingMaterials,null);
  const changed=buildSupplyPriorityQueries(new Date('2026-08-15T00:00:00Z'),true,{...context,materials:['Another material']});
  updated=supplyMailCursor(updated,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'ignored',priorityQueries:changed});
  assert.ok(updated.pendingMaterials);
  updated=supplyMailCursor(updated,{now,backfillComplete:false,lastSuccessfulSyncAt:null,broadQuery:'ignored',priorityQueries:reordered});
  assert.equal(updated.pendingMaterials,null);assert.deepEqual(updated.scans.MATERIALS,retained);
});
