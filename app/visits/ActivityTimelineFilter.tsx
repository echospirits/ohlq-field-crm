"use client";
import { Children, useMemo, useState, type ReactNode } from "react";
import { RecordPicker } from "../components/RecordPicker";
export type TimelineFilterEntry = {
  id: string;
  type: string;
  source: string;
  at: string;
  staff: string;
  contacts: string[];
  opportunity: string;
};
export function ActivityTimelineFilter({
  entries,
  children,
  contacts,
  tableHead,
}: {
  entries: TimelineFilterEntry[];
  children: ReactNode;
  contacts: Record<string, string>;
  tableHead?: ReactNode;
}) {
  const [type, setType] = useState(""),
    [source, setSource] = useState(""),
    [staff, setStaff] = useState(""),
    [contact, setContact] = useState(""),
    [opportunity, setOpportunity] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [filterResetKey, setFilterResetKey] = useState(0);
  const nodes = Children.toArray(children);
  const matches = entries
    .map((e, i) => ({ e, node: nodes[i] }))
    .filter(
      ({ e }) =>
        (!type || e.type === type) &&
        (!source || e.source === source) &&
        (!staff || e.staff === staff) &&
        (!contact || e.contacts.includes(contact)) &&
        (!opportunity || e.opportunity === opportunity) &&
        (!start || e.at.slice(0, 10) >= start) &&
        (!end || e.at.slice(0, 10) <= end),
    );
  const options = (key: "type" | "source" | "staff" | "opportunity") =>
    [...new Set(entries.map((e) => e[key]).filter(Boolean))].map((value) => ({
      value,
      label: value,
    }));
  const activeFilters = [type, source, staff, contact ? contacts[contact] ?? 'Archived contact' : '', opportunity ? 'Opportunity selected' : '', start ? `From ${start} UTC` : '', end ? `Through ${end} UTC` : ''].filter(Boolean);
  return (
    <>
      <details className="compact-details">
        <summary>Filter history{activeFilters.length ? ` · ${activeFilters.length} active` : ''}</summary>
        <div className="form-grid" key={filterResetKey}>
          <RecordPicker
            name="historyType"
            label="Activity type"
            options={options("type")}
            placeholder="All types"
            clearLabel="All types"
            onChange={setType}
          />
          <RecordPicker
            name="historySource"
            label="Activity source"
            options={options("source")}
            placeholder="All sources"
            clearLabel="All sources"
            onChange={setSource}
          />
          <RecordPicker
            name="historyStaff"
            label="Staff member"
            options={options("staff")}
            placeholder="All staff"
            clearLabel="All staff"
            onChange={setStaff}
          />
          <RecordPicker
            name="historyContact"
            label="Contact"
            options={[...new Set(entries.flatMap((e) => e.contacts))].map(
              (id) => ({
                value: id,
                label: contacts[id] ?? "Archived contact",
              }),
            )}
            placeholder="All contacts"
            clearLabel="All contacts"
            onChange={setContact}
          />
          <RecordPicker
            name="historyOpportunity"
            label="Opportunity"
            options={options("opportunity")}
            placeholder="All opportunities"
            clearLabel="All opportunities"
            onChange={setOpportunity}
          />
          <label>
            From date (UTC)
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Through date (UTC)
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      </details>
      <div className="history-filter-status"><p className="record-meta" aria-live="polite">{matches.length} of {entries.length} loaded records{activeFilters.length ? ` · ${activeFilters.join(' · ')}` : ''}</p>
      {activeFilters.length ? <button className="secondary" type="button" onClick={() => { setType(''); setSource(''); setStaff(''); setContact(''); setOpportunity(''); setStart(''); setEnd(''); setFilterResetKey((current) => current + 1); }}>Clear filters</button> : null}</div>
      {tableHead ? <div className="table-scroll" role="region" aria-label="Visit history" tabIndex={0}><table className="comparison-table visit-history-table"><thead>{tableHead}</thead><tbody>{matches.map(({ node }) => node)}</tbody></table></div> : <div className="visit-activity-list">
        {matches.map(({ e, node }) => (
          <div key={e.id}>{node}</div>
        ))}
      </div>}
      {!matches.length ? (
        <p className="muted">No loaded history matches these filters.</p>
      ) : null}
    </>
  );
}
