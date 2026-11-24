import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { extendWithAccountStateAccess, loadStateScope, withAccountStateScope } from '../lib/accountStateAccess';
import { modelHasStatePolicy } from '../lib/accountStatePolicy';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';

async function main() {
 const {url}=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 assert.equal(new URL(url).hostname, 'ep-square-feather-avx1mt9w-pooler.c-11.us-east-1.aws.neon.tech', 'Only the dedicated rehearsal branch is allowed.');
 assert.ok(!url.includes('ep-noisy-dew'),'Use the isolated rehearsal branch, not shared TST.');
 const base=new PrismaClient({datasources:{db:{url}}});
 const db=extendWithAccountStateAccess(base);
 try {
  assert.equal(await loadStateScope(base, ECHO_ORGANIZATION_ID), null, 'Echo sales workflows use the shared directory.');
  const echo=await loadStateScope(base,ECHO_ORGANIZATION_ID,{restrictToConfiguredStates:true});
  const ohio=await loadStateScope(base,'org_neat_staging');
  assert.ok(echo && ohio, 'Both configured-state rehearsal scopes must exist.');
  const fl={...echo,states:['FL'],agencyIds:echo.agencyIds.filter(id=>id.startsWith('abc-fws-fl-')),agencyNumbers:[],restaurantIds:[]};
  await withAccountStateScope(ohio,async()=>{
   assert.equal(await db.agency.count({where:{id:{startsWith:'abc-fws-fl-'}}}),0);
   assert.equal(await db.agency.findUnique({where:{id:'abc-fws-fl-003'}}),null);
   assert.equal(await db.locationContact.count({where:{agencyId:'abc-fws-fl-003'}}),0);
   assert.equal(await db.organizationAccountOverlay.count({where:{externalAccountId:'abc-fws-fl-003'}}),0);
   assert.equal((await db.agency.updateMany({where:{id:'abc-fws-fl-003'},data:{city:'MUST NOT CHANGE'}})).count,0);
   await assert.rejects(db.locationContact.create({data:{organizationId:'org_neat_staging',name:'BLOCKED',agencyId:'abc-fws-fl-003'}}));
   await assert.rejects(db.wholesaleAccount.create({data:{name:'BLOCKED',licenseeId:'BLOCKED',state:'FL'}}));
   const tags=await db.tag.findMany({where:{organizationId:'org_echo_spirits',name:'ABC Fine Wine & Spirits'},include:{locationTags:true,_count:true}});
   // Relation spelling is checked below using actual DMMF metadata.
   assert.ok(tags.every(tag=>tag.locationTags.length===0 && tag._count.locationTags===0));
  });
  await withAccountStateScope(echo,async()=>{
   assert.equal(await db.agency.count({where:{id:{startsWith:'abc-fws-fl-'}}}),126);
   assert.equal(await db.locationContact.count({where:{agencyId:{startsWith:'abc-fws-fl-'}}}),126);
   assert.equal(await db.organizationAccountOverlay.count({where:{externalAccountId:{startsWith:'abc-fws-fl-'}}}),126);
   const account=await db.agency.findUnique({where:{id:'abc-fws-fl-003'},include:{tags:{include:{tag:true}}}});
   assert.equal(account?.tags.length,1);
  });
  const exercised:string[]=[];
  for (const checkScope of [fl, ohio]) await withAccountStateScope(checkScope,async()=>{
   if (checkScope === fl) assert.equal(await db.agency.count({where:{state:'OH'}}),0);
   for(const model of Prisma.dmmf.datamodel.models.filter(m=>modelHasStatePolicy(m.name))){
    const key=model.name[0].toLowerCase()+model.name.slice(1);
    try {
      const include = Object.fromEntries(model.fields.filter(f=>f.kind==='object' && f.relationFromFields?.length).map(f=>[f.name,true]));
      await (db as any)[key].findMany({take:1,include});exercised.push(checkScope.states.join('+') + ':' + model.name);
    }
    catch(error){throw new Error(`${model.name}: ${String(error)}`);}
   }
  });
  console.log(JSON.stringify({passed:true,echoStates:echo.states,otherStates:ohio.states,modelsExercised:exercised},null,2));
 } finally {await base.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
