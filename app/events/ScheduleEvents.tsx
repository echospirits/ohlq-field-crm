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
      <details className="section-disclosure schedule-events" id="events">
        <summary><strong>Events and staff schedule</strong><span className="disclosure-meta">{events.length ? `${events.length} ${events.length === 1 ? 'event' : 'events'}` : 'None scheduled'}</span></summary>
        <p className="field-note">
          Upcoming events and the past 30 days, up to 100 events. All times
          include a timezone.
        </p>
        {events.length ? (
          <ul className="schedule-event-list">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`}>{e.title}</Link> ·{" "}
                {e.startsAt.toLocaleString("en-US", {
                  timeZone: organization.timezone,
                  timeZoneName: "short",
                })}{" "}
                · {e.status}
                <p>
                  {e.staffUserIds
                    .map((id) => users.find((u) => u.id === id))
                    .filter(Boolean)
                    .map((u) => getUserDisplayName(u!))
                    .join(", ") || "Staff not assigned"}
                </p>
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
      </details>
  );
}
