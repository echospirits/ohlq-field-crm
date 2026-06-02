import {
  MenuPlacementSource,
  MenuPlacementStatus,
  MenuPlacementType,
  type MenuPlacement,
  type User,
  type Visit,
} from '@prisma/client';
import { getUserDisplayName } from '../../lib/auth';
import { formatDateOnly, formatDateOnlyInputValue, formatEasternDate } from '../../lib/dateTime';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { createMenuPlacement, deleteMenuPlacement, updateMenuPlacement } from './actions';

type MenuPlacementWithUsers = MenuPlacement & {
  assignedToUser: Pick<User, 'email' | 'firstName' | 'lastName' | 'name'> | null;
  createdByUser: Pick<User, 'email' | 'firstName' | 'lastName' | 'name'> | null;
  updatedByUser: Pick<User, 'email' | 'firstName' | 'lastName' | 'name'> | null;
};

type MenuPlacementPanelProps = {
  accountId: string | null;
  wholesaleAccountId: string;
  placements: MenuPlacementWithUsers[];
  returnTo: string;
  users: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'name'>[];
  visits: Pick<Visit, 'id' | 'visitDate' | 'summary'>[];
  filters: {
    q: string;
    status: string;
    placementType: string;
  };
};

const placementTypeLabels: Record<MenuPlacementType, string> = {
  [MenuPlacementType.COCKTAIL_MENU]: 'Cocktail menu',
  [MenuPlacementType.MENU_FEATURE]: 'Menu feature',
  [MenuPlacementType.HAPPY_HOUR]: 'Happy hour',
  [MenuPlacementType.TABLE_TENT]: 'Table tent',
  [MenuPlacementType.QR_DIGITAL]: 'QR / digital',
  [MenuPlacementType.BACK_BAR]: 'Back bar',
  [MenuPlacementType.OTHER]: 'Other',
};

const statusLabels: Record<MenuPlacementStatus, string> = {
  [MenuPlacementStatus.PROMISED]: 'Promised',
  [MenuPlacementStatus.LIVE]: 'Live',
  [MenuPlacementStatus.PAUSED]: 'Paused',
  [MenuPlacementStatus.ENDED]: 'Ended',
  [MenuPlacementStatus.LOST]: 'Lost',
};

const sourceLabels: Record<MenuPlacementSource, string> = {
  [MenuPlacementSource.MANUAL]: 'Manual',
  [MenuPlacementSource.VISIT]: 'Visit',
  [MenuPlacementSource.PHOTO]: 'Photo',
  [MenuPlacementSource.ACCOUNT_REVIEW]: 'Account review',
  [MenuPlacementSource.IMPORT]: 'Import',
};

function PlacementFields({
  placement,
  users,
}: {
  placement?: MenuPlacement;
  users: MenuPlacementPanelProps['users'];
}) {
  return (
    <>
      <div className="form-grid">
        <label>
          Product
          <input name="product" defaultValue={placement?.product ?? ''} required />
        </label>
        <label>
          Cocktail / menu item
          <input name="menuItemName" defaultValue={placement?.menuItemName ?? ''} required />
        </label>
        <label>
          Placement type
          <select name="placementType" defaultValue={placement?.placementType ?? MenuPlacementType.COCKTAIL_MENU}>
            {Object.values(MenuPlacementType).map((placementType) => (
              <option key={placementType} value={placementType}>
                {placementTypeLabels[placementType]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={placement?.status ?? MenuPlacementStatus.PROMISED}>
            {Object.values(MenuPlacementStatus).map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select name="source" defaultValue={placement?.source ?? MenuPlacementSource.MANUAL}>
            {Object.values(MenuPlacementSource).map((source) => (
              <option key={source} value={source}>
                {sourceLabels[source]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned user
          <select name="assignedToUserId" defaultValue={placement?.assignedToUserId ?? ''}>
            <option value="">-- Unassigned --</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {getUserDisplayName(user)}
              </option>
            ))}
          </select>
        </label>
        <label>
          First seen
          <input name="firstSeenAt" type="date" defaultValue={formatDateOnlyInputValue(placement?.firstSeenAt)} />
        </label>
        <label>
          Last verified
          <input name="lastVerifiedAt" type="date" defaultValue={formatDateOnlyInputValue(placement?.lastVerifiedAt)} />
        </label>
        <label>
          Expected end
          <input name="expectedEndAt" type="date" defaultValue={formatDateOnlyInputValue(placement?.expectedEndAt)} />
        </label>
      </div>
      <label>
        Notes
        <textarea name="notes" rows={3} defaultValue={placement?.notes ?? ''} />
      </label>
    </>
  );
}

export function MenuPlacementPanel({
  accountId,
  wholesaleAccountId,
  placements,
  returnTo,
  users,
  visits,
  filters,
}: MenuPlacementPanelProps) {
  return (
    <section className="dashboard-section" id="menu-placements">
      <div className="section-heading">
        <h2>Menu Placements</h2>
        <span className="pill">{placements.length}</span>
      </div>

      <details className="card compact-details admin-panel">
        <summary>Create menu placement</summary>
        <form action={createMenuPlacement} className="menu-placement-form">
          <input name="returnTo" type="hidden" value={returnTo} />
          <input name="wholesaleAccountId" type="hidden" value={wholesaleAccountId} />
          {accountId ? <input name="accountId" type="hidden" value={accountId} /> : null}
          {visits.length > 0 ? (
            <label>
              Related visit
              <select name="visitId">
                <option value="">-- No related visit --</option>
                {visits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {formatEasternDate(visit.visitDate)}
                    {visit.summary ? ` - ${visit.summary.slice(0, 80)}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <PlacementFields users={users} />
          <details className="compact-details nested-details">
            <summary>Proof</summary>
            <div className="photo-entry fast-photo-entry">
              <h3>Proof</h3>
              <input name="proofFile" type="file" accept="image/*" />
              <input name="proofUrl" type="url" placeholder="Existing proof URL" />
              <span className="field-note">Menu photo or proof link</span>
            </div>
          </details>
          <button type="submit">Save placement</button>
        </form>
      </details>

      <details className="card compact-details filter-panel">
        <summary>Filter placements</summary>
        <LiveFilterForm className="placement-filter" label="Filter menu placements">
          <label>
            Search
            <input name="placementQ" defaultValue={filters.q} placeholder="Product, menu item, notes, owner" />
          </label>
          <label>
            Status
            <select name="placementStatusFilter" defaultValue={filters.status}>
              <option value="">All statuses</option>
              {Object.values(MenuPlacementStatus).map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="placementTypeFilter" defaultValue={filters.placementType}>
              <option value="">All types</option>
              {Object.values(MenuPlacementType).map((placementType) => (
                <option key={placementType} value={placementType}>
                  {placementTypeLabels[placementType]}
                </option>
              ))}
            </select>
          </label>
        </LiveFilterForm>
      </details>

      {placements.length === 0 ? (
        <p className="muted">No menu placements match the current filters.</p>
      ) : (
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Placement</th>
              <th>Status</th>
              <th>Dates</th>
              <th>Proof</th>
              <th>Owner</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {placements.map((placement) => (
              <tr key={placement.id}>
                <td data-label="Placement">
                  <strong>{placement.menuItemName}</strong>
                  <div className="muted">{placement.product}</div>
                  <div className="inline-meta">
                    <span className="pill">{placementTypeLabels[placement.placementType]}</span>
                    <span className="pill">{sourceLabels[placement.source]}</span>
                  </div>
                  {placement.notes ? <p className="muted preserve-lines">{placement.notes}</p> : null}
                </td>
                <td data-label="Status">
                  <span className="pill">{statusLabels[placement.status]}</span>
                </td>
                <td data-label="Dates">
                  <div className="placement-date-list">
                    <span>First: {formatDateOnly(placement.firstSeenAt) || 'Not set'}</span>
                    <span>Verified: {formatDateOnly(placement.lastVerifiedAt) || 'Not set'}</span>
                    <span>Expected end: {formatDateOnly(placement.expectedEndAt) || 'Not set'}</span>
                  </div>
                </td>
                <td data-label="Proof">
                  {placement.proofUrl ? (
                    <a href={placement.proofUrl} rel="noreferrer" target="_blank">
                      Open proof
                    </a>
                  ) : (
                    <span className="muted">No proof</span>
                  )}
                </td>
                <td data-label="Owner">
                  {placement.assignedToUser ? getUserDisplayName(placement.assignedToUser) : 'Unassigned'}
                  <div className="muted item-meta">
                    Updated by{' '}
                    {placement.updatedByUser ? getUserDisplayName(placement.updatedByUser) : 'Unknown user'}
                  </div>
                </td>
                <td data-label="Actions">
                  <details className="compact-details inline-edit-details">
                    <summary>Edit</summary>
                    <form action={updateMenuPlacement} className="menu-placement-form">
                      <input name="id" type="hidden" value={placement.id} />
                      <input name="returnTo" type="hidden" value={returnTo} />
                      <PlacementFields placement={placement} users={users} />
                      <details className="compact-details nested-details">
                        <summary>Proof</summary>
                        {placement.proofUrl ? (
                          <label className="quick-chip">
                            <input name="removeProof" type="checkbox" />
                            <span>Remove current proof</span>
                          </label>
                        ) : null}
                        <div className="photo-entry fast-photo-entry">
                          <h3>Proof</h3>
                          <input name="proofFile" type="file" accept="image/*" />
                          <input name="proofUrl" type="url" placeholder="Replacement proof URL" />
                        </div>
                      </details>
                      <button type="submit">Save changes</button>
                    </form>
                  </details>
                  <form action={deleteMenuPlacement}>
                    <input name="id" type="hidden" value={placement.id} />
                    <input name="returnTo" type="hidden" value={returnTo} />
                    <button className="secondary compact-btn" type="submit">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
