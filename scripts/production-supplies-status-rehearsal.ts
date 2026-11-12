import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient, Prisma } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';

async function main(){
  const envFile=process.argv.find(arg=>arg.startsWith('--env-file='))?.slice(11) || '.env.supplies.local';
  const env=Object.fromEntries(parseEnvironmentFile(readFileSync(envFile,'utf8')));
  if(env.APP_ENV!=='development' || env.DATABASE_TARGET_ID!=='supplies-rehearsal' || new URL(env.DATABASE_URL).hostname!==env.EXPECTED_DATABASE_HOST || !env.EXPECTED_DATABASE_HOST.endsWith('.neon.tech'))throw new Error('Only the isolated supplies-rehearsal database is allowed.');
  for(const[key,value]of Object.entries(env))process.env[key]=value;
  const direct=new URL(env.DATABASE_URL);direct.hostname=direct.hostname.replace('-pooler.','.');
  const db=new PrismaClient({datasourceUrl:direct.toString()});
  const service=await import('../lib/productionSupplies/service');
  const status=await import('../lib/productionSupplies/status');
  const run=randomUUID().slice(0,8),now=Date.now(),base=now-5*86400000;
  const at=(hours:number)=>new Date(base+hours*3600000);
  const passed:string[]=[];const pass=(message:string)=>{passed.push(message);console.log(`PASS ${message}`);};
  const actor={organizationId:`org_status_${run}`,userId:`status_admin_${run}`};
  async function warning(a:typeof actor,material:string,tag:string,when:Date,unit='units',materialId?:string){return service.ingestEvidence(a,{source:{provider:'SYNTHETIC_STATUS',messageId:`${run}-${tag}`,messageDate:when.toISOString(),contentHash:`${run}-${tag}`,historical:true,extractionStatus:'COMPLETE'},evidence:{kind:'WARNING',warningSource:'DISTILLX5_EMAIL',warning:{material,materialId,location:'Synthetic production',quantity:4,threshold:10,unit}}},db);}
  async function catalog(a:typeof actor,name:string){return service.saveCatalogItem(a,{name,unit:'case',departments:['PRODUCTION'],sharedUse:false},db);}
  async function ordered(a:typeof actor,name:string,itemId:string,tag:string){const order=await service.createManualOrder(a,{supplier:'Synthetic status supplier',orderReference:`TEST-${run}-${tag}`,destination:'Synthetic production',orderedAt:at(1).toISOString().slice(0,10),idempotencyKey:`${run}-${tag}`,lines:[{description:name,catalogItemId:itemId,sku:`TEST-${tag}`,quantity:10,unit:'case',department:'PRODUCTION'}]},db);const line=await db.supplyOrderLine.findFirstOrThrow({where:{organizationId:a.organizationId,orderId:order.id}});return{order,line};}
  async function shipping(a:typeof actor,o:Awaited<ReturnType<typeof ordered>>,tag:string,shipStatus:string,qty=10){const shipment=await service.attachTracking(a,{orderId:o.order.id,referenceType:'PARCEL',reference:`SYNTHETIC-${run}-${tag}`,carrier:'UPS',timezone:'America/New_York',lines:[{lineId:o.line.id,quantity:qty}]},db);await db.supplyShipment.update({where:{id:shipment.id},data:{status:shipStatus,statusEventAt:at(3),deliveredAt:shipStatus==='DELIVERED'?at(3):null}});return shipment;}
  try{
    // UI fixtures use separate synthetic Echo users/materials. Lifecycle assertions below use another tenant.
    const echo=await db.organization.findUniqueOrThrow({where:{id:'org_echo_spirits'}});
    const uiActor={organizationId:echo.id,userId:`status_qa_admin_${run}`},uiViewer=`status_qa_viewer_${run}`;
    await db.user.createMany({data:[{id:uiActor.userId,organizationId:echo.id,email:`${uiActor.userId}@example.invalid`,name:'Supply status QA Admin',role:'ADMIN',isActive:true},{id:uiViewer,organizationId:echo.id,email:`${uiViewer}@example.invalid`,name:'Supply status QA Viewer',role:'USER',isActive:true}]});
    const prefs=echo.crmPreferences as Prisma.JsonObject,settings=(prefs.productionSupplies || {}) as Prisma.JsonObject;
    await db.organization.update({where:{id:echo.id},data:{crmPreferences:{...prefs,productionSupplies:{...settings,viewerUserIds:[...(Array.isArray(settings.viewerUserIds)?settings.viewerUserIds as string[]:[]),uiViewer]}}}});
    await db.organizationFeature.upsert({where:{organizationId_featureKey:{organizationId:echo.id,featureKey:'PRODUCTION_SUPPLIES'}},create:{organizationId:echo.id,featureKey:'PRODUCTION_SUPPLIES',enabled:true},update:{enabled:true}});
    const uiNames=['No order','Order found','Incoming','Delayed','Completed'].map(label=>`QA ${label} material ${run}`);
    for(let index=0;index<uiNames.length;index++){
      const item=await catalog(uiActor,uiNames[index]);await warning(uiActor,uiNames[index],`ui-alert-${index}`,at(0));
      if(index===0)continue;
      const o=await ordered(uiActor,uiNames[index],item.id,`ui-order-${index}`);
      if(index===1)continue;
      const shipment=await shipping(uiActor,o,`ui-shipment-${index}`,index===4?'DELIVERED':index===3?'DELAYED':'IN_TRANSIT');
      if(index!==4)await service.saveArrivalExpectation(uiActor,{shipmentId:shipment.id,source:'SUPPLIER_PROMISE',precision:'DATE',startDate:new Date(now+2*86400000).toISOString().slice(0,10),timezone:'America/New_York'},db);
    }
    const ui=await status.getSupplyStatusDashboard(echo.id,db);
    const uiCards=ui.cards.filter(card=>uiNames.includes(card.material));assert.equal(uiCards.length,4);
    const sessions=await Promise.all([{id:uiActor.userId,role:'ADMIN'},{id:uiViewer,role:'VIEWER'}].map(async user=>{const token=randomBytes(32).toString('base64url');await db.userSession.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+6*3600000)}});return{role:user.role,token};}));
    mkdirSync('output',{recursive:true});writeFileSync('output/production-supplies-status-qa.json',JSON.stringify({synthetic:true,rehearsal:true,organizationId:echo.id,cards:uiCards.map(card=>({needId:card.needId,cycleKey:card.cycleKey,material:card.material,status:card.status})),cardIds:uiCards.map(card=>card.id),completedMaterial:uiNames[4],sessions},null,2));
    console.log('UI_FIXTURES_READY output/production-supplies-status-qa.json');
    if(process.argv.includes('--ui-only'))return;

    await db.organization.create({data:{id:actor.organizationId,name:'Synthetic status lifecycle',displayName:'Synthetic status lifecycle',slug:`status-${run}`,accountStatus:'ACTIVE',crmPreferences:{productionSupplies:{viewerUserIds:[`status_viewer_${run}`]}},features:{create:[{featureKey:'PRODUCTION_SUPPLIES',enabled:true}]}}});
    await db.user.createMany({data:[{id:actor.userId,organizationId:actor.organizationId,email:`${actor.userId}@example.invalid`,role:'ADMIN',isActive:true},{id:`status_viewer_${run}`,organizationId:actor.organizationId,email:`status_viewer_${run}@example.invalid`,role:'USER',isActive:true}]});
    const name=`Synthetic caps ${run}`,first=await warning(actor,name,'first-alert',at(0));
    await warning(actor,name,'repeat-different-unit',at(1),'CASE');
    let dashboard=await status.getSupplyStatusDashboard(actor.organizationId,db);assert.equal(dashboard.cards.length,1);assert.equal(await db.supplyNeed.count({where:{organizationId:actor.organizationId}}),1);pass('Repeated usage alerts and unit changes produce one material/location card and one need.');
    const initial=dashboard.cards[0];await status.dismissSupplyStatusCard(actor,{needId:initial.needId,cycleKey:initial.cycleKey},db);
    await db.supplyAudit.updateMany({where:{organizationId:actor.organizationId,action:'SUPPLY_STATUS_DISMISSED'},data:{createdAt:at(1)}});
    await warning(actor,name,'enriched-id-repeat',at(2),'units','SYNTHETIC-CAPS-ID');
    assert.equal((await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.length,0);pass('Dismissal survives a later usage alert that enriches the raw material ID.');
    const item=await catalog(actor,name),o=await ordered(actor,name,item.id,'replacement'),shipment=await shipping(actor,o,'replacement','DELIVERED');
    assert.equal((await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.length,0);
    await warning(actor,name,'new-after-delivery',at(4),'units','SYNTHETIC-CAPS-ID');
    dashboard=await status.getSupplyStatusDashboard(actor.organizationId,db);assert.equal(dashboard.cards.length,1);assert.notEqual(dashboard.cards[0].cycleKey,initial.cycleKey);assert.equal(dashboard.cards[0].status,'NO_ORDER_FOUND');
    await assert.rejects(()=>status.dismissSupplyStatusCard(actor,{needId:initial.needId,cycleKey:initial.cycleKey},db),/changed/);
    await service.ingestEvidence(actor,{source:{provider:'SYNTHETIC_STATUS',messageId:`${run}-first-alert`,messageDate:at(0).toISOString(),contentHash:`${run}-first-alert`,historical:true,extractionStatus:'COMPLETE'},evidence:{kind:'WARNING',warningSource:'DISTILLX5_EMAIL',warning:{material:name,location:'Synthetic production',quantity:4,threshold:10,unit:'units'}}},db);
    assert.equal((await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.length,1);pass('Completed replenishment plus a genuinely later alert opens a new cycle; stale dismiss and old replay cannot replace it.');
    await assert.rejects(()=>status.dismissSupplyStatusCard({organizationId:echo.id,userId:actor.userId},{needId:dashboard.cards[0].needId,cycleKey:dashboard.cards[0].cycleKey},db),/access/);
    await assert.rejects(()=>status.dismissSupplyStatusCard({organizationId:actor.organizationId,userId:`status_viewer_${run}`},{needId:dashboard.cards[0].needId,cycleKey:dashboard.cards[0].cycleKey},db),/management/);pass('Cross-tenant actors and read-only viewers cannot dismiss shared cards.');
    const partName=`Synthetic partial bottles ${run}`,partItem=await catalog(actor,partName);await warning(actor,partName,'partial-alert',at(0));
    const partOrder=await ordered(actor,partName,partItem.id,'partial'),firstPart=await shipping(actor,partOrder,'partial-1','DELIVERED',5);await shipping(actor,partOrder,'partial-2','IN_TRANSIT',5);
    assert.ok((await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.some(card=>card.material===partName));
    await db.supplyShipment.update({where:{id:firstPart.id},data:{status:'RETURNED',returnedAt:at(4)}});
    assert.equal((await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.find(card=>card.material===partName)?.statusLabel,'Shipment returned');pass('Partial shipments remain visible and a returned parcel cannot complete the cycle.');
    const staleName=`Synthetic stale labels ${run}`,staleItem=await catalog(actor,staleName);await warning(actor,staleName,'stale-alert',at(0));
    const staleOrder=await ordered(actor,staleName,staleItem.id,'stale'),staleShipment=await shipping(actor,staleOrder,'stale','IN_TRANSIT');
    await service.saveArrivalExpectation(actor,{shipmentId:staleShipment.id,source:'SUPPLIER_PROMISE',precision:'DATE',startDate:new Date(now+86400000).toISOString().slice(0,10),timezone:'America/New_York'},db);
    await db.supplyShipment.update({where:{id:staleShipment.id},data:{checkError:'Synthetic tracking outage'}});
    assert.ok((await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.find(card=>card.material===staleName)?.arrival);pass('A tracking outage preserves the last valid source-labeled arrival.');
    const mixed=await db.supplySource.create({data:{organizationId:actor.organizationId,userId:actor.userId,provider:'SYNTHETIC_STATUS',messageId:`${run}-unrelated-warning`,messageDate:at(50),contentHash:'synthetic-other',extractionStatus:'COMPLETE',extractedFacts:{kind:'WARNING',warningSource:'OTHER_EMAIL',warning:{material:name,location:'Synthetic production',quantity:999,threshold:999,unit:'other'}}}});
    await db.supplyWarningOccurrence.create({data:{organizationId:actor.organizationId,needId:first.needId!,sourceId:mixed.id,warningKey:`other-${run}`,warningAt:at(50),reportedQuantity:999,reportedThreshold:999}});
    await db.supplyNeed.update({where:{id:first.needId},data:{source:'OTHER_EMAIL',latestWarningAt:at(50)}});
    const pure=(await status.getSupplyStatusDashboard(actor.organizationId,db)).cards.find(card=>card.needId===first.needId)!;assert.equal(pure.lastAlertAt,at(4).toISOString());pass('Actual Dx5 occurrences qualify legacy mixed-source needs; unrelated later warnings do not advance their cycle.');
    assert.equal(await db.supplyReceipt.count({where:{organizationId:actor.organizationId}}),0);assert.equal(await db.supplyNeed.count({where:{organizationId:actor.organizationId,resolvedAt:{not:null}}}),0);pass('Delivery hiding and dismissal create neither receipts nor need-resolution/inventory transactions.');
    writeFileSync('output/production-supplies-status-rehearsal-results.json',JSON.stringify({synthetic:true,target:'supplies-rehearsal',passed,uiFixtureReady:true},null,2));console.log(JSON.stringify({passed:passed.length,uiFixtureReady:true}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Status rehearsal failed.');process.exitCode=1;});
