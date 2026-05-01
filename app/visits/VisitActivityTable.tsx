import { getUserDisplayName } from '../../lib/auth';
import { VisitPhotoGallery } from './VisitPhotoGallery';

export type VisitActivity = {
  id: string;
  visitAt: Date;
  contactId: string | null;
  summary: string | null;
  outcomes: string | null;
  nextStep: string | null;
  followUpDate: Date | null;
  createdBy: string | null;
  createdByUser: {
    email: string;
    name: string | null;
  } | null;
  photos: {
    id: string;
    url: string;
    caption: string | null;
    type: string;
  }[];
};

type VisitActivityTableProps = {
  visits: VisitActivity[];
  contactMap: Record<string, string>;
};

const formatDate = (date: Date | null) => (date ? new Date(date).toLocaleDateString() : '');
const formatDateTime = (date: Date) => new Date(date).toLocaleString();

export function VisitActivityTable({ visits, contactMap }: VisitActivityTableProps) {
  if (visits.length === 0) {
    return <p className="muted activity-empty">No visits have been logged for this account yet.</p>;
  }

  return (
    <table className="responsive-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Contact</th>
          <th>Summary</th>
          <th>Outcomes</th>
          <th>Next Step</th>
          <th>Follow-up</th>
          <th>Created By</th>
          <th>Photos</th>
        </tr>
      </thead>
      <tbody>
        {visits.map((visit) => (
          <tr key={visit.id}>
            <td data-label="Date">{formatDateTime(visit.visitAt)}</td>
            <td data-label="Contact">{contactMap[visit.contactId ?? '']}</td>
            <td data-label="Summary">{visit.summary}</td>
            <td data-label="Outcomes">{visit.outcomes}</td>
            <td data-label="Next Step">{visit.nextStep}</td>
            <td data-label="Follow-up">{formatDate(visit.followUpDate)}</td>
            <td data-label="Created By">
              {visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy}
            </td>
            <td data-label="Photos">
              <VisitPhotoGallery photos={visit.photos} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
