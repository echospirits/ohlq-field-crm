export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';
export default async function Accounts(){
 const accounts = await prisma.account.findMany({take:100,orderBy:{name:'asc'},include:{tags:{include:{tag:true}}, salesFacts:{take:3,orderBy:{periodMonth:'desc'}}}});
 return <><h1>Accounts</h1><table><thead><tr><th>Name</th><th>Type</th><th>City</th><th>Tags</th><th>Recent bottles</th></tr></thead><tbody>{accounts.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.type}</td><td>{a.city}</td><td>{a.tags.map(t=><span className="pill" key={t.tagId}>{t.tag.name}</span>)}</td><td>{a.salesFacts.reduce((s,f)=>s+f.retailBottles+f.wholesaleBottles,0)}</td></tr>)}</tbody></table></>;
}
