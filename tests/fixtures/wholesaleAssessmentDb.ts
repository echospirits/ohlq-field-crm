import type { PrismaClient } from '@prisma/client';
export function assessmentDb(count = 3, options: { failId?: string; inactive?: boolean; loseLease?: boolean } = {}) {
  const asOf = new Date(); asOf.setUTCDate(asOf.getUTCDate()-1); asOf.setUTCHours(0,0,0,0);
  const accounts = Array.from({length:count},(_,i)=>({ id:`a${String(i).padStart(4,'0')}`,name:`Account ${i}`,state:i%2?'KY':'OH',licenseeId:String(10000+i),licenseeIds:[],address:'1 Main St',city:'City',zip:'12345',targetPublicResearch:null,tags:[],currentAssessments:[] }));
  const assessments = new Map<string,Record<string,unknown>>(), runs: Record<string,unknown>[] = [], pursuitWrites: Record<string,unknown>[] = [];
  const queries: Array<{name:string;args:unknown}> = [];
  let active = 0, peak = 0, rawQueries = 0;
  const pursuits: Array<Record<string,unknown>> = [];
  const db: Record<string,any> = {
    organization: { findFirst:async()=>options.inactive?null:{id:'tenant'},findMany:async()=>[{id:'tenant'}],findUnique:async()=>({id:'tenant',appName:'CRM',digestName:'CRM',displayName:'Tenant',productLabel:'Tenant',productPluralLabel:'Tenant products',products:[],vendorIdentifiers:[]}) },
    organizationProduct:{findMany:async()=>[]},ohlqBrandMasterItem:{findMany:async()=>[]},
    ohlqReportImportStatus:{findFirst:async()=>null,findMany:async()=>[]},
    ohlqTenantInventoryImportStatus:{findFirst:async()=>null},ohlqAgencyInventoryCurrent:{findMany:async()=>[]},
    wholesaleSalesLedgerDay:{findMany:async()=>[]},
    wholesaleAssessmentRun:{
      create:async({data}:any)=>{const row={...data,id:`run${runs.length}`};runs.push(row);return row;},
      updateMany:async({where,data}:any)=>{if(where.id)return {count:options.loseLease?0:1};return {count:0};},
      update:async({where,data}:any)=>{const r=runs.find(r=>r.id===where.id)!;Object.assign(r,data);return r;},
    },
    wholesaleAccountAssessment:{findFirst:async()=>null,upsert:async({create,update}:any)=>{
      active++;peak=Math.max(peak,active);
      try{await new Promise(r=>setTimeout(r,2));if(create.wholesaleAccountId===options.failId)throw new Error('simulated account failure');
        const previous=assessments.get(create.wholesaleAccountId);assessments.set(create.wholesaleAccountId,previous?{...previous,...update}:create);return create;
      }finally{active--;}
    }},
    wholesaleAccount:{count:async({where}:any)=>where.id?.in?accounts.filter(a=>where.id.in.includes(a.id)).length:accounts.length,
      findMany:async(args:any)=>{queries.push({name:'accounts',args});if(args.select)return accounts.filter(a=>a.state==='OH');
        const rows=args.where.id?.in?accounts.filter(a=>args.where.id.in.includes(a.id)):accounts;
        const start=args.cursor?rows.findIndex(a=>a.id===args.cursor.id)+1:0;return rows.slice(start,start+args.take);
      }},
    accountSalesEvent:{findMany:async(args:any)=>{queries.push({name:'events',args});return [];}},
    organizationAccountOverlay:{findMany:async()=>[]},menuPlacement:{findMany:async()=>[]},loggedVisit:{findMany:async()=>[]},worklistItem:{findMany:async()=>[]},
    salesOpportunity:{findMany:async()=>pursuits,update:async({data}:any)=>{pursuitWrites.push(data);return data;}},
    ohlqAnnualSalesByWholesaleRow:{findMany:async()=>{rawQueries++;return [];}},
  };
  db.$executeRaw=async(query:any)=>{
    const rows=JSON.parse(query.values[0]);
    if(rows.some((r:any)=>r.wholesaleAccountId===options.failId))throw new Error('simulated batch failure');
    for(const row of rows)await db.wholesaleAccountAssessment.upsert({create:row,update:row});
    return rows.length;
  };
  db.$transaction=async(fn:any)=>fn(db);
  return {db:db as PrismaClient,raw:db,accounts,assessments,runs,pursuits,pursuitWrites,queries,peak:()=>peak,rawQueries:()=>rawQueries};
}
