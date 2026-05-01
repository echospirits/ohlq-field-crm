import { getUserDisplayName } from '../../lib/auth';
import { addLocationTag, removeLocationTag } from './actions';
import { TagBadges, type TagBadgeData } from './TagBadges';

type TagOption = TagBadgeData & {
  description: string | null;
};

type LocationTagAssignment = {
  id: string;
  note: string | null;
  createdAt: Date;
  tag: TagBadgeData;
  createdByUser: {
    email: string;
    name: string | null;
  } | null;
};

type AccountTagPanelProps = {
  assignments: LocationTagAssignment[];
  tags: TagOption[];
  locationType: 'agency' | 'wholesale';
  locationId: string;
  returnTo: string;
};

const formatDateTime = (date: Date) => new Date(date).toLocaleString();

export function AccountTagPanel({
  assignments,
  tags,
  locationType,
  locationId,
  returnTo,
}: AccountTagPanelProps) {
  const assignedTagIds = new Set(assignments.map((assignment) => assignment.tag.id));
  const availableTags = tags.filter((tag) => !assignedTagIds.has(tag.id));
  const locationField = locationType === 'agency' ? 'agencyId' : 'wholesaleAccountId';

  return (
    <div className="card account-tag-panel">
      <div className="section-heading">
        <h3>Tags</h3>
        <span className="pill">{assignments.length}</span>
      </div>

      <TagBadges tags={assignments.map((assignment) => assignment.tag)} />

      <form action={addLocationTag} className="tag-apply-form">
        <input name={locationField} type="hidden" value={locationId} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <label>Add tag</label>
        <select disabled={availableTags.length === 0} name="tagId" required>
          <option value="">-- Select tag --</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
              {tag.description ? ` - ${tag.description}` : ''}
            </option>
          ))}
        </select>
        <input name="note" placeholder="Optional note or reason" />
        <button disabled={availableTags.length === 0} type="submit">
          Add tag
        </button>
      </form>

      {assignments.length > 0 ? (
        <div className="tag-audit-list">
          {assignments.map((assignment) => (
            <div className="tag-audit-row" key={assignment.id}>
              <div>
                <TagBadges tags={[assignment.tag]} />
                <p className="muted">
                  Added {formatDateTime(assignment.createdAt)} by{' '}
                  {assignment.createdByUser ? getUserDisplayName(assignment.createdByUser) : 'Unknown user'}
                </p>
                {assignment.note ? <p className="muted preserve-lines">{assignment.note}</p> : null}
              </div>
              <form action={removeLocationTag}>
                <input name="id" type="hidden" value={assignment.id} />
                <input name={locationField} type="hidden" value={locationId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <button className="secondary" type="submit">
                  Remove
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
