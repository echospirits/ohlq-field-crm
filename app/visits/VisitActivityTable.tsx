import { ActivityTimelineFilter } from './ActivityTimelineFilter';
import Link from 'next/link';
import { getUserDisplayName } from '../../lib/auth';
import { formatEasternDateTime, formatWorklistDue } from '../../lib/dateTime';
import { getVisitOutcomeDisplay } from '../../lib/visitWorkflow';
import { VisitPhotoGallery } from './VisitPhotoGallery';

export type VisitActivity = {
  guidedAnswers?: unknown;
  salesOpportunityId?: string|null;
  agencyProductIntelligenceId?: string|null;
  id: string;
  visitAt: Date;
  locationType: string;
  locationName?: string | null;
  locationHref?: string | null;
  contactId: string | null;
  contacts?: Array<{ contact: { id: string; name: string } }>;
  summary: string | null;
  outcomes: string | null;
  outcomeCodes: string[];
  nextStep: string | null;
  followUpMode: string | null;
  followUpDate: Date | null;
  followUpTimeMinutes: number | null;
  createdBy: string | null;
  createdByUser: { email: string; name: string | null } | null;
  photos: { id: string; url: string; caption: string | null; type: string }[];
  worklistItems: { id: string; status: string; title: string }[];
};

type VisitActivityTableProps = {
  visits: VisitActivity[];
  contactMap: Record<string, string>;
  supplementalEvents?: Array<{ type?: string; source?:string; contactIds?:string[]; opportunity?:string; actor?: string | null; at: Date; detail: string; href?: string; linkLabel?: string; id: string; title: string }>;
};

export type SupplementalActivity = NonNullable<VisitActivityTableProps['supplementalEvents']>[number];

export const followUpLabel = (visit: VisitActivity) => {
  if (visit.worklistItems.length > 0) {
    const openCount = visit.worklistItems.filter((item) => item.status === 'OPEN' || item.status === 'IN_PROGRESS').length;
    return openCount > 0 ? `${openCount} open worklist ${openCount === 1 ? 'item' : 'items'}` : 'Worklist item completed';
  }
  if (visit.nextStep) return visit.followUpDate ? `${visit.nextStep} · ${formatWorklistDue(visit.followUpDate, visit.followUpTimeMinutes)}` : visit.nextStep;
  return null;
};

export function VisitActivityTable({ visits, contactMap, supplementalEvents }: VisitActivityTableProps) {
  const extraEvents = supplementalEvents ?? [];
  if (visits.length === 0 && extraEvents.length === 0) return <p className="muted activity-empty">{supplementalEvents ? 'No activity has been logged yet.' : 'No visits have been logged yet.'}</p>;
  const events = [
    ...visits.map((visit) => ({ at: visit.visitAt, kind: 'visit' as const, visit })),
    ...extraEvents.map((event) => ({ at: event.at, event, kind: 'supplemental' as const })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime());

  return (
    <ActivityTimelineFilter contacts={contactMap} entries={events.map(activity=>activity.kind==='visit'?{id:`visit-${activity.visit.id}`,type:'Physical visit',source:'Log Visit',at:activity.at.toISOString(),staff:activity.visit.createdByUser?getUserDisplayName(activity.visit.createdByUser):activity.visit.createdBy??'',contacts:[...(activity.visit.contacts?.map(c=>c.contact.id)??[]),...(activity.visit.contactId?[activity.visit.contactId]:[])],opportunity:activity.visit.salesOpportunityId??activity.visit.agencyProductIntelligenceId??''}:{id:activity.event.id,type:activity.event.type??activity.event.title,source:activity.event.source??'CRM',at:activity.at.toISOString(),staff:activity.event.actor??'',contacts:activity.event.contactIds??[],opportunity:activity.event.opportunity??''})}>
      {events.map((activity) => {
        if (activity.kind === 'supplemental') return <article className="visit-activity-card" key={`supplemental-${activity.event.id}`}>
          <header><div><time dateTime={activity.event.at.toISOString()}>{formatEasternDateTime(activity.event.at)}</time><strong>{activity.event.title}</strong></div>{activity.event.actor ? <span>{activity.event.actor}</span> : null}</header>
          <p className="visit-note">{activity.event.detail}</p>
          {activity.event.href ? <div className="visit-card-meta">{activity.event.href.startsWith('https://') ? <a href={activity.event.href} target="_blank" rel="noopener noreferrer">{activity.event.linkLabel ?? 'Open original'}</a> : <Link href={activity.event.href}>{activity.event.linkLabel ?? 'View order'}</Link>}</div> : null}
        </article>;
        const visit = activity.visit;
        const outcomeLabels = getVisitOutcomeDisplay({
          locationType: visit.locationType,
          outcomeCodes: visit.outcomeCodes,
          legacyOutcomes: visit.outcomes,
        });
        const followUp = followUpLabel(visit);
        const rep = visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy;
        const contactNames = visit.contacts?.map((link) => link.contact.name) ?? (contactMap[visit.contactId ?? ''] ? [contactMap[visit.contactId ?? '']] : []);

        return (
            <article className="visit-activity-card" key={`visit-${visit.id}`}>
            <header>
              <div>
                <time dateTime={visit.visitAt.toISOString()}>{formatEasternDateTime(visit.visitAt)}</time>
                {visit.locationName ? (
                  visit.locationHref ? <Link href={visit.locationHref}>{visit.locationName}</Link> : <strong>{visit.locationName}</strong>
                ) : null}
              </div>
              <span>{rep}</span>
            </header>
            {outcomeLabels.length > 0 ? (
              <div aria-label="Visit outcomes" className="visit-outcome-badges">
                {outcomeLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
            ) : null}
            {visit.guidedAnswers && typeof visit.guidedAnswers==='object' && Array.isArray((visit.guidedAnswers as {answers?:unknown}).answers) ? <details><summary>Visit guide answers</summary>{((visit.guidedAnswers as {answers:Array<{question:string;answer:string}>}).answers).map((answer,index)=><p key={index}><strong>{answer.question}</strong><br/>{answer.answer||'Not recorded'}</p>)}</details> : null}
            {visit.summary ? <p className="visit-note preserve-lines">{visit.summary}</p> : null}
            <div className="visit-card-meta">
              {contactNames.length ? <span>Met with {contactNames.join(' and ')}</span> : null}
              {followUp ? <span className="visit-follow-up-status">Next: {followUp}</span> : null}
              {visit.photos.length > 0 ? <span>{visit.photos.length} {visit.photos.length === 1 ? 'photo' : 'photos'}</span> : null}
              <Link href={`/visits/${visit.id}/edit`}>Edit visit</Link>
            </div>
            {visit.photos.length > 0 ? <VisitPhotoGallery photos={visit.photos} /> : null}
          </article>
        );
      })}
    </ActivityTimelineFilter>
  );
}
