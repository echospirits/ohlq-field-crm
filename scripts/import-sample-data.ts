import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { prisma } from '../lib/prisma';

const DATA_DIR = process.env.DATA_DIR || '/mnt/data';
function rows(file:string){ return Papa.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''),{header:true,skipEmptyLines:true}).data as any[]; }
function clean(v:any){ return String(v ?? '').trim(); }
function num(v:any){ const n = Number(String(v ?? '0').replace(/[$,]/g,'')); return Number.isFinite(n) ? n : 0; }

async function importAccounts(){
 for (const r of rows(path.join(DATA_DIR,'Partner Agencies.csv'))) {
   const agencyId = clean(r.AgencyID); if(!agencyId) continue;
   await prisma.account.upsert({where:{agencyId}, update:{name:clean(r.DBA), city:clean(r.City), county:clean(r.County), zip:clean(r.Zip), phone:clean(r['Agency Phone']), d8Permit:clean(r['D-8 Permit']).toLowerCase().startsWith('y')}, create:{agencyId,type:'LIQUOR_AGENCY',name:clean(r.DBA),address:clean(r.Address),city:clean(r.City),county:clean(r.County),zip:clean(r.Zip),phone:clean(r['Agency Phone']),d8Permit:clean(r['D-8 Permit']).toLowerCase().startsWith('y')}});
 }
 for (const tag of ['Cut','Fix','Add','Outperform','Watchlist','Menu Target','Display Opportunity','Lapsed Buyer']) await prisma.tag.upsert({where:{name:tag},update:{},create:{name:tag}});
}

async function importCoverage(){
 for (const file of fs.readdirSync(DATA_DIR).filter(f=>f.startsWith('ITEM COVERAGE') && f.endsWith('.csv'))) {
   const itemCode = file.match(/-\s+(\w+)\s+/)?.[1] || file.split(' ')[3];
   const sku = await prisma.sku.upsert({where:{itemCode}, update:{}, create:{itemCode,name:file.replace(/^ITEM COVERAGE - /,'').replace('.csv','')}});
   for (const r of rows(path.join(DATA_DIR,file))) {
     const agencyId = clean(r['Agency ID']); if(!agencyId) continue;
     const account = await prisma.account.findUnique({where:{agencyId}}); if(!account) continue;
     await prisma.inventoryFact.create({data:{accountId:account.id, skuId:sku.id, coverageStatus:clean(r['Coverage                                                                                                           Group']), minFlag:clean(r.Min).toUpperCase()==='MIN', inventoryBottles:num(r['Inventory                                                  (Bottles)                                                  As of Today']), sales12MoBottles:num(r['Sales                                                     (Bottles)                                                     12 Months'])}}).catch(()=>{});
   }
 }
}

async function seedRecipes(){
 const vodka = await prisma.sku.findFirst({where:{itemCode:'3135B'}});
 await prisma.recipe.upsert({where:{id:'sample-echo-mule'}, update:{}, create:{id:'sample-echo-mule',name:'Echo Mule',skuId:vodka?.id,season:'Year-round',flavorProfile:'bright, ginger, citrus',complexity:'easy',glassware:'Collins',ingredients:[{'item':'Vodka','amount':'1.5 oz'},{'item':'lime','amount':'.5 oz'},{'item':'ginger beer','amount':'top'}],instructions:'Build over ice and garnish with lime.',garnish:'lime wheel'}});
}

async function generateLapsedBuyerAlerts(){
 // Placeholder rule: accounts with historical inventory coverage but no open alert yet.
 const tag = await prisma.tag.findUnique({where:{name:'Lapsed Buyer'}});
 const facts = await prisma.inventoryFact.findMany({take:25,include:{account:true,sku:true}});
 for (const f of facts) await prisma.alert.create({data:{accountId:f.accountId,skuId:f.skuId,type:'LAPSED_BUYER_REVIEW',title:`Review ${f.account.name}`,detail:`Check recent orders for ${f.sku.itemCode}; dismiss, snooze, or add a note after review.`}}).catch(()=>{});
}

async function main(){ await importAccounts(); await importCoverage(); await seedRecipes(); await generateLapsedBuyerAlerts(); }
main().finally(()=>prisma.$disconnect());
