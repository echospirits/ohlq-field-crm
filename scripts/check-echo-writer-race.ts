import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prisma } from '../lib/prisma';
import { importOhlqAnnualSalesCsv } from '../lib/ohlqAnnualSalesImport';
import { ECHO_SALES_REPORT_ID } from '../lib/echoBottleSalesCoverage';
const head='Agency_Id,Vendor,Brand,Retail_Bottles_Sold,Wholesale_Bottles_Sold';
function load(date:string, csv:string, when:string, statewide=false) {
 return importOhlqAnnualSalesCsv({reportDate:date,csv,evidence:{
  native:{reportIdentity:ECHO_SALES_REPORT_ID,scope:statewide?'COMPLETE_STATEWIDE':'VENDOR_FILTERED',
   requestedFrom:date,requestedTo:date,acquiredAt:when,exportCompleted:true},requestReference:'fixture:'+when}});
}
async function main() {
 assert.match(process.env.DATABASE_URL ?? '', /@localhost:5432\/synthetic_echo$/);
 for (const sql of [
 'CREATE TABLE "Organization"(id text PRIMARY KEY, active boolean, "accountStatus" text, "enabledStates" text[])',
 "INSERT INTO \"Organization\" VALUES ('org_echo_spirits',true,'ACTIVE',ARRAY['OH'])",
 'CREATE TABLE "Agency"("agencyId" text PRIMARY KEY,warehouse text,name text)',
 'CREATE TABLE "OhlqBrandMasterItem"("itemCode" text PRIMARY KEY,name text,category text)',
 'CREATE TABLE "OhlqAnnualSalesRow"("reportDate" date,"agencyId" text,vendor text,brand text,"retailBottlesSold" int,"wholesaleBottlesSold" int,PRIMARY KEY("reportDate","agencyId",vendor,brand))',
 ]) await prisma.$executeRawUnsafe(sql);
 for (const path of [
 'prisma/migrations/20261120020000_echo_item_sales_reporting/migration.sql',
 'prisma/migrations/20261121023000_echo_bottle_sales_month_readiness/migration.sql',
 ]) for (const sql of fs.readFileSync(path,'utf8').split(';').filter(s=>s.trim())) await prisma.$executeRawUnsafe(sql);
 const date='2026-09-01';
 const old='2026-10-01T12:00:00Z', newer='2026-10-02T12:00:00Z';
 const echoOld=head+'\n001,Z90399001,V01,-3,0';
 const stateNew=head+'\n001,Z90399001,V01,8,4\n001,OTHER,V02,99,0';
 const concurrent=await Promise.allSettled([load(date,stateNew,newer,true),load(date,echoOld,old)]);
 assert.equal(concurrent[0].status,'fulfilled');
 const read=async()=> {const rows=await prisma.ohlqAnnualSalesRow.findMany({orderBy:{vendor:'asc'}});
 assert.deepEqual(rows.map(r=>[r.vendor,r.retailBottlesSold]),[['OTHER',99],['Z90399001',8]]);
 const receipt=await prisma.echoBottleSalesDayCoverage.findFirstOrThrow();
 assert.equal(receipt.sourceAcquiredAt?.toISOString(),new Date(newer).toISOString());return receipt;};
 await read();
 await assert.rejects(load(date,echoOld,old),/Stale or unordered/);
 await read();
 const same=await read();
 await load(date,stateNew,newer,true);
 assert.equal((await read()).completedAt.getTime(),same.completedAt.getTime());
 await load('2026-09-02',head,newer);
 const empty=await prisma.echoBottleSalesDayCoverage.findUniqueOrThrow({where:{reportDate:new Date('2026-09-02T00:00:00Z')}});
 assert.equal(empty.expectedRowCount,0);
 assert.equal(empty.expectedFactsSha256,'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',dateStyle:'short'}).format(new Date());
 if (today.slice(8)!=='01') {
   const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
   await load(yesterday,head,new Date().toISOString());
   const rows=await prisma.$queryRawUnsafe('SELECT * FROM echo_item_sales_day_coverage WHERE "Sales_Date" = $1::date',yesterday);
   assert.deepEqual(rows,[]);
 }
 console.log('Concurrent statewide and Echo-only imports, stale rollback, exact replay, zero-day and partial-month cases passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
