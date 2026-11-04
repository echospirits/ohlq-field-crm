import Link from "next/link";
import { prisma } from "../../lib/prisma";
import { getUserDisplayName } from "../../lib/auth";
import { EventEditor } from "./EventEditor";
export async function ScheduleEvents({
  organizationId,
}: {
  organizationId: string;
}) {
  const [events, users, organization] = await Promise.all([
    prisma.eventShift.findMany({
      where: {
        organizationId,
        startsAt: { gte: new Date(Date.now() - 30 * 86400000) },
        status: { not: "cancelled" },
      },
      orderBy: { startsAt: "asc" },
      take: 100,
    }),
    prisma.user.findMany({
      where: {
        organizationId,
        isActive: true,
        role: { not: "PLATFORM_ADMIN" },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    }),
  ]);
  return (
      <section className="workspace-section schedule-events" id="events" aria-labelledby="schedule-events-title">
        <div className="section-heading"><h2 id="schedule-events-title">Events and staff schedule</h2><span className="pill">{events.length}</span></div>
        <p className="record-meta">Upcoming and past 30 days{events.length === 100 ? ' · First 100 events' : ''}</p>
        {events.length ? (
          <ul className="schedule-event-list">
            {events.map((e) => (
              <li key={e.id}>
                <div className="schedule-event-identity"><Link href={`/events/${e.id}`}>{e.title}</Link><time dateTime={e.startsAt.toISOString()}>{e.startsAt.toLocaleString("en-US", {
                  timeZone: organization.timezone,
                  timeZoneName: "short",
                })}</time>{e.location ? <span className="muted">{e.location}</span> : null}</div>
                <div className="schedule-event-staff">
                  {e.staffUserIds.map((id) => { const member = users.find((candidate) => candidate.id === id); return member ? getUserDisplayName(member) : 'Inactive staff member'; }).join(", ") || "Staff not assigned"}
                </div>
                <span className="pill">{e.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No events scheduled.</p>
        )}
        <details className="compact-details">
          <summary>Add event or shift</summary>
          <EventEditor
            users={users.map((u) => ({
              id: u.id,
              name: getUserDisplayName(u),
            }))}
          />
        </details>
      </section>
  );
}
