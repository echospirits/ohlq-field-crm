import { writeFileSync } from 'node:fs';
import { validateRuntimeEnvironment } from '../lib/appEnvironment';
import { prisma } from '../lib/prisma';
import { assessWholesaleAccount } from '../lib/wholesaleAssessment';
import { input, purchase } from '../tests/fixtures/wholesaleAssessment';

// Read-only whole-population comparison against preserved legacy pursuit snapshots.
// Old values are historical, not rerun V6 estimates or identical-source forecasts.
async function main() {
  if (validateRuntimeEnvironment().appEnvironment === 'production') throw new Error('This development comparison refuses production.');
  const organizationId = process.argv[2];
  if (!organizationId) throw new Error('Provide an organization ID and optional output JSON path.');
  const rows = await prisma.$queryRaw<Array<{ accountId: string; priority: number; mode: string; state: string; product: string | null; category: string | null; bottles30: number | null; oldPriority: number | null; oldCategory: string | null }>>`
    WITH previous AS (
      SELECT DISTINCT ON ("wholesaleAccountId") "wholesaleAccountId", "productionScore", "targetCategory"
      FROM "SalesOpportunity" WHERE "organizationId"=${organizationId} AND "scoringVersion" NOT LIKE 'WHOLESALE_ASSESSMENT%'
      ORDER BY "wholesaleAccountId", "lastDetectedAt" DESC, "id"
    )
    SELECT a."wholesaleAccountId" AS "accountId", a."priority", a."evidenceMode" AS "mode", a."state",
      a."assessment" #>> '{candidates,0,product,name}' AS product,
      a."assessment" #>> '{candidates,0,product,category}' AS category,
      (a."assessment" #>> '{observed,bottles30}')::float AS "bottles30",
      p."productionScore" AS "oldPriority", p."targetCategory" AS "oldCategory"
    FROM "WholesaleAccountAssessment" a LEFT JOIN previous p ON p."wholesaleAccountId"=a."wholesaleAccountId"
    WHERE a."organizationId"=${organizationId} ORDER BY md5(a."wholesaleAccountId")`;
  const counts = (values: Array<string | null>) => values.reduce<Record<string,number>>((a,v) => { a[v ?? 'None']=(a[v ?? 'None']??0)+1;return a; },{});
  const compared=rows.filter(r=>r.oldPriority!==null);
  const summary={organizationId,total:rows.length,withHistoricalComparison:compared.length,withoutPreviousPursuit:rows.length-compared.length,
    evidenceModes:counts(rows.map(r=>r.mode)),states:counts(rows.map(r=>r.state)),previousCategoryMix:counts(compared.map(r=>r.oldCategory)),currentCategoryMix:counts(rows.map(r=>r.category)),
    previousHigh:compared.filter(r=>r.oldPriority!>=70).length,currentHigh:rows.filter(r=>r.priority>=70).length,
    lowObserved30HighBefore:compared.filter(r=>r.bottles30!==null&&r.bottles30<=12&&r.oldPriority!>=70).length,
    lowObserved30HighNow:rows.filter(r=>r.bottles30!==null&&r.bottles30<=12&&r.priority>=70).length,
    estimatedAdditionalVolume:'Unavailable for every assessment; no invented estimates',contribution:'Unavailable; economics absent'};
  // Fixed hash order, first 100: reproducible broad sample independent of either score.
  const sample=rows.slice(0,100);
  const synthetic=assessWholesaleAccount(input({name:'Synthetic two-rum-bottles-per-30-days example; not the reported real account',purchases:[purchase(6)],scaleEvidence:null,uses:[]}));
  const result={summary,sample,synthetic:{label:'Synthetic fixture only. Reported real account not present in TST.',priority:synthetic.priority,title:synthetic.title,effort:synthetic.effort,reasons:synthetic.reasons},limitations:['Historical snapshots and current calculations differ in date and source coverage. This measures operational change, not predictive improvement.','Sample is selected by account-ID hash, not by recommendation quality.','Observed low volume under partial coverage is not verified total volume.']};
  if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2));
  console.log(JSON.stringify({summary,synthetic:result.synthetic,limitations:result.limitations},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
