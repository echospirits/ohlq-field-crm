import { VisitActivityTable } from "../../visits/VisitActivityTable";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "../../../lib/prisma";
import { requireCrmActor } from "../../../lib/crm/auth";
import { getUserDisplayName } from "../../../lib/auth";
import { eventSalesComparison } from "../../../lib/crm/events";
import { EventEditor } from "../EventEditor";
import { formatEasternDateTime } from "../../../lib/dateTime";
export const dynamic = "force-dynamic";
export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireCrmActor();
  const { id } = await params;
  const event = await prisma.eventShift.findFirst({
    where: { id, organizationId: actor.organizationId },
    include: {
      visits: {
        where: { organizationId: actor.organizationId },
        include: {
          photos: true,
          contacts: { include: { contact: true } },
          createdByUser: { select: { email: true, name: true } },
          worklistItems: { select: { id: true, title: true, status: true } },
        },
      },
    },
  });
  if (!event) notFound();
  const [users, comparison] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        isActive: true,
        role: { not: "PLATFORM_ADMIN" },
      },
      select: { id: true, name: true, email: true },
    }),
    eventSalesComparison(prisma, actor.organizationId, event),
  ]);
  const account = event.externalAccountId
    ? event.accountType === "AGENCY"
      ? await prisma.agency.findUnique({
          where: { id: event.externalAccountId },
          select: { name: true },
        })
      : await prisma.wholesaleAccount.findUnique({
          where: { id: event.externalAccountId },
          select: { name: true },
        })
    : null;
  const visit = new URLSearchParams({
    type: event.accountType === "AGENCY" ? "agency" : "wholesale",
    [event.accountType === "AGENCY" ? "agencyId" : "wholesaleAccountId"]:
      event.externalAccountId ?? "",
    eventId: id,
    returnTo: `/events/${id}`,
  });
  return (
    <>
      <Link href="/#events">My Schedule</Link>
      <h1>{event.title}</h1>
      <section className="workspace-section" aria-label="Event overview">
        <dl className="read-summary event-overview">
          <div><dt>Starts</dt><dd>{formatEasternDateTime(event.startsAt)}</dd></div>
          {event.endsAt ? <div><dt>Ends</dt><dd>{formatEasternDateTime(event.endsAt)}</dd></div> : null}
          <div><dt>Status</dt><dd><span className="pill">{event.status}</span></dd></div>
          <div><dt>Location</dt><dd>{event.location || 'Not set'}</dd></div>
          {account ? <div><dt>Account</dt><dd>{account.name}</dd></div> : null}
          <div><dt>Staff</dt><dd>{event.staffUserIds.map((staffId) => { const member = users.find((candidate) => candidate.id === staffId); return member ? getUserDisplayName(member) : 'Inactive staff member'; }).join(', ') || 'Staff not assigned'}</dd></div>
          {event.attendance != null ? <div><dt>Attendance</dt><dd>{event.attendance}</dd></div> : null}
        </dl>
        {(event.details as { products?: string }).products ? <p><strong>Products</strong> · {(event.details as { products?: string }).products}</p> : null}
        {(event.details as { outcomes?: string }).outcomes ? <p className="preserve-lines"><strong>Outcomes</strong> · {(event.details as { outcomes?: string }).outcomes}</p> : null}
      </section>
      {event.source === "EVENTBRITE" ? (
        <details className="compact-details">
          <summary>Latest Eventbrite details</summary>
          <p className="field-note">
            Imported provider values for review; saving your local schedule does
            not publish changes to Eventbrite.
          </p>
          {Object.entries(
            ((event.details as Record<string, unknown>).providerSnapshot ??
              {}) as Record<string, unknown>,
          )
            .filter(([key]) =>
              [
                "title",
                "startsAt",
                "endsAt",
                "location",
                "status",
                "mock",
              ].includes(key),
            )
            .map(([key, value]) => (
              <p key={key}>
                {key}: {String(value)}
              </p>
            ))}
        </details>
      ) : null}
      <details className="compact-details event-editor">
        <summary>Edit event</summary>
        <EventEditor
          event={{
            ...event,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt?.toISOString() ?? null,
            details: event.details as Record<string, never>,
          }}
          users={users.map((u) => ({ id: u.id, name: getUserDisplayName(u) }))}
          accountName={account?.name}
        />
      </details>
      <section className="workspace-section">
        <h2>Execution and follow-up</h2>
        {event.externalAccountId ? (
          <Link className="btn" href={`/visits/new?${visit}`}>
            Log Visit, photos, and follow-up
          </Link>
        ) : (
          <p>
            Link an account above to record an account visit and its follow-up
            tasks.
          </p>
        )}
        <VisitActivityTable visits={event.visits} contactMap={{}} />
      </section>
      <section className="workspace-section">
        <h2>Observed sales before and after</h2>
        <p>
          Recorded purchases do not establish event impact. Event-day sales are excluded;
          source dates are report dates, not exact order times.
        </p>
        {comparison.available ? (
          <>
            <p>
              {comparison.days}-day windows ·{" "}
              {comparison.comparison === "PREVIOUS_YEAR"
                ? "Same period last year"
                : "Immediately preceding period"}
            </p>
            <div className="table-scroll" role="region" aria-label="Event sales comparison" tabIndex={0}><table className="comparison-table event-comparison-table">
              <thead><tr><th>Period</th><th className="numeric">Bottles</th><th className="numeric">Covered days</th></tr></thead>
              <tbody><tr><th scope="row">Before</th><td className="numeric">{comparison.before?.bottles ?? "Unknown"}</td><td className="numeric">{comparison.before?.coveredDays ?? "Unknown"}/{comparison.days}</td></tr>
              <tr><th scope="row">After</th><td className="numeric">{comparison.after?.bottles ?? "Unknown"}</td><td className="numeric">{comparison.after?.coveredDays ?? "Unknown"}/{comparison.days}</td></tr></tbody>
            </table></div>
            <p className="field-note">
              Tenant products only. A total is shown only with complete daily
              ledger coverage; future or missing days are unknown.
            </p>
          </>
        ) : (
          <p>{comparison.reason}</p>
        )}
      </section>
    </>
  );
}
