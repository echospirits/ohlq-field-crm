import Link from 'next/link';
import { getUserDisplayName } from '../../lib/auth';
import { formatEasternDateTime } from '../../lib/dateTime';
import { getVisitOutcomeDisplay } from '../../lib/visitWorkflow';
import { ActivityTimelineFilter } from './ActivityTimelineFilter';
import { followUpLabel, type VisitActivity } from './VisitActivityTable';
import { VisitPhotoGallery } from './VisitPhotoGallery';

// The global history compares visits; account workspaces retain their detailed timeline.
export function VisitHistoryTable({ visits, contactMap }: { visits: VisitActivity[]; contactMap: Record<string, string> }) {
  return <ActivityTimelineFilter
    contacts={contactMap}
    entries={visits.map((visit) => ({
      id: visit.id, type: 'Physical visit', source: 'Log Visit', at: visit.visitAt.toISOString(),
      staff: visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy ?? '',
      contacts: [...(visit.contacts?.map(({ contact }) => contact.id) ?? []), ...(visit.contactId ? [visit.contactId] : [])],
      opportunity: visit.salesOpportunityId ?? visit.agencyProductIntelligenceId ?? '',
    }))}
    tableHead={<tr><th>Date</th><th>Account</th><th>Visit and outcomes</th><th>Follow-up</th><th>Rep</th><th><span className="sr-only">Edit visit</span></th></tr>}
  >
    {visits.map((visit) => {
      const outcomes = getVisitOutcomeDisplay({ locationType: visit.locationType, outcomeCodes: visit.outcomeCodes, legacyOutcomes: visit.outcomes });
      const contactNames = visit.contacts?.map(({ contact }) => contact.name) ?? (visit.contactId && contactMap[visit.contactId] ? [contactMap[visit.contactId]] : []);
      const followUp = followUpLabel(visit);
      return <tr key={visit.id}>
        <td className="visit-history-date"><time dateTime={visit.visitAt.toISOString()}>{formatEasternDateTime(visit.visitAt)}</time></td>
        <td className="visit-history-account">{visit.locationHref ? <Link href={visit.locationHref}>{visit.locationName}</Link> : <strong>{visit.locationName || 'Unknown account'}</strong>}{contactNames.length ? <small>Met with {contactNames.join(' and ')}</small> : null}</td>
        <td className="visit-history-notes">{outcomes.length ? <div className="visit-outcome-badges" aria-label="Visit outcomes">{outcomes.map((outcome) => <span key={outcome}>{outcome}</span>)}</div> : null}{visit.summary ? <p className="preserve-lines">{visit.summary}</p> : <span className="muted">No notes recorded</span>}
          {visit.photos.length ? <details className="compact-details visit-history-photos"><summary>{visit.photos.length} {visit.photos.length === 1 ? 'photo' : 'photos'}</summary><VisitPhotoGallery photos={visit.photos} /></details> : null}
          {visit.guidedAnswers && typeof visit.guidedAnswers === 'object' && Array.isArray((visit.guidedAnswers as { answers?: unknown }).answers) ? <details className="compact-details"><summary>Visit guide answers</summary>{((visit.guidedAnswers as { answers: Array<{ question: string; answer: string }> }).answers).map((answer, index) => <p key={index}><strong>{answer.question}</strong><br />{answer.answer || 'Not recorded'}</p>)}</details> : null}
        </td>
        <td className="visit-history-follow-up">{followUp || <span className="muted">No follow-up recorded</span>}{visit.nextStep && visit.nextStep !== followUp ? <small>{visit.nextStep}</small> : null}{visit.worklistItems.length ? <div className="visit-history-task-links">{visit.worklistItems.map((item) => <Link href={`/alerts?status=ALL&q=${encodeURIComponent(item.title)}#worklist-${encodeURIComponent(item.id)}`} key={item.id}>{item.title}<span className="muted"> · {item.status.toLowerCase().replaceAll('_', ' ')}</span></Link>)}</div> : null}</td>
        <td className="visit-history-rep">{visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy || 'Unknown user'}</td>
        <td className="visit-history-actions"><Link href={`/visits/${visit.id}/edit`}>Edit<span className="sr-only"> visit at {visit.locationName || 'account'}</span></Link></td>
      </tr>;
    })}
  </ActivityTimelineFilter>;
}
