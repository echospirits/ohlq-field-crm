export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';
export default async function Alerts(){
 const alerts = await prisma.alert.findMany({where:{status:'OPEN'},take:100,orderBy:{createdAt:'desc'},include:{account:true}});
 return <><h1>Worklist</h1><p className="muted">Generated alerts for lapsed buyers, inventory-with-no-movement, missing photo proof, and follow-up gaps.</p><table><thead><tr><th>Alert</th><th>Account</th><th>Detail</th><th>Status</th></tr></thead><tbody>{alerts.map(a=><tr key={a.id}><td>{a.title}</td><td>{a.account.name}</td><td>{a.detail}</td><td>{a.status}</td></tr>)}</tbody></table></>;
}
