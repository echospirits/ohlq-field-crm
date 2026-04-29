export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';
export default async function Events(){
 const events = await prisma.eventShift.findMany({take:100,orderBy:{startsAt:'asc'}});
 return <><h1>Tour Guide Scheduling</h1><p className="muted">Manual shifts now; Eventbrite sync stub included in /scripts.</p><table><thead><tr><th>Event</th><th>When</th><th>Location</th><th>Status</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{e.title}</td><td>{e.startsAt.toLocaleString()}</td><td>{e.location}</td><td>{e.status}</td></tr>)}</tbody></table></>;
}
