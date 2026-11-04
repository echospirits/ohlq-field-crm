"use client";
import { useState, useEffect } from "react";
import { CrmForm } from "../components/CrmForm";
import { CrmAccountPicker } from "../components/CrmAccountPicker";
import { RecordPicker } from "../components/RecordPicker";
import { saveEventAction } from "./actions";
type Details = {
  products?: string;
  samples?: number | null;
  cost?: number | null;
  outcomes?: string;
  photoLinks?: string;
  windowDays?: number;
  comparison?: string;
};
type Event = {
  id: string;
  version: number;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  eventType: string;
  status: string;
  attendance: number | null;
  staffUserIds: string[];
  details: Details;
  accountType: "AGENCY" | "WHOLESALE" | null;
  externalAccountId: string | null;
};
const local = (raw?: string | null) => {
  if (!raw) return "";
  const d = new Date(raw);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function EventEditor({
  event,
  users,
  accountName,
}: {
  event?: Event;
  users: Array<{ id: string; name: string }>;
  accountName?: string;
}) {
  const [key, setKey] = useState(""),
    [staff, setStaff] = useState(event?.staffUserIds ?? []),
    [start, setStart] = useState(local(event?.startsAt)),
    [end, setEnd] = useState(local(event?.endsAt));
  useEffect(() => setKey(crypto.randomUUID()), []);
  const details = event?.details ?? {};
  return (
    <CrmForm action={saveEventAction} submitLabel="Save event">
      <input type="hidden" name="id" value={event?.id ?? ""} />
      <input type="hidden" name="version" value={event?.version ?? 0} />
      <input type="hidden" name="submissionKey" value={key} />
      <label>
        Event title
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={event?.title}
        />
      </label>
      <div className="form-grid">
        <label>
          Type
          <select name="eventType" defaultValue={event?.eventType ?? "TASTING"}>
            {[
              "TASTING",
              "TRAINING",
              "CONSUMER",
              "ACCOUNT",
              "TOUR",
              "SAMPLING",
              "PROMOTION",
            ].map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={event?.status ?? "open"}>
            {["open", "confirmed", "completed", "cancelled"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label>
          Starts (your local time)
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Ends (your local time)
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <input
        name="startsAt"
        type="hidden"
        value={start ? new Date(start).toISOString() : ""}
      />
      <input
        name="endsAt"
        type="hidden"
        value={end ? new Date(end).toISOString() : ""}
      />
      <label>
        Location
        <input
          name="location"
          maxLength={500}
          defaultValue={event?.location ?? ""}
        />
      </label>
      <CrmAccountPicker
        initial={
          event?.accountType && event.externalAccountId
            ? {
                accountType: event.accountType,
                accountId: event.externalAccountId,
                name: accountName ?? event.externalAccountId,
              }
            : undefined
        }
      />
      <RecordPicker
        name="staffPicker"
        label="Add staff member"
        placeholder="Search staff"
        options={users
          .filter((u) => !staff.includes(u.id))
          .map((u) => ({ value: u.id, label: u.name }))}
        onChange={(id) => {
          if (id && !staff.includes(id)) setStaff([...staff, id]);
        }}
      />
      {staff.map((id) => (
        <div key={id}>
          <input name="staffUserId" type="hidden" value={id} />
          <span>
            {users.find((u) => u.id === id)?.name ?? "Inactive staff member"}
          </span>{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => setStaff(staff.filter((s) => s !== id))}
          >
            Remove
          </button>
        </div>
      ))}
      <details open={Boolean(details.products || details.outcomes || event?.attendance != null || details.samples != null || details.cost != null)}>
        <summary>Products, results, and cost</summary>
        <label>
          Products and quantities
          <textarea
            name="products"
            maxLength={3000}
            defaultValue={details.products}
          />
        </label>
        <div className="form-grid">
          <label>
            Attendance
            <input
              name="attendance"
              type="number"
              min={0}
              max={1000000}
              step={1}
              defaultValue={event?.attendance ?? ""}
            />
          </label>
          <label>
            Samples served
            <input
              name="samples"
              type="number"
              min={0}
              max={1000000}
              defaultValue={details.samples ?? ""}
            />
          </label>
          <label>
            Total cost (USD)
            <input
              name="cost"
              type="number"
              min={0}
              max={1000000}
              step="0.01"
              defaultValue={details.cost ?? ""}
            />
          </label>
        </div>
        <label>
          Outcomes
          <textarea
            name="outcomes"
            maxLength={6000}
            defaultValue={details.outcomes}
          />
        </label>
        <label>
          Photo links (one HTTPS link per line)
          <textarea
            name="photoLinks"
            maxLength={3000}
            defaultValue={details.photoLinks}
          />
        </label>
        <p className="field-note">
          For account events, use Log Visit to upload photo proof and create
          follow-ups.
        </p>
        <label>
          Sales comparison window (days)
          <input
            name="windowDays"
            type="number"
            min={7}
            max={90}
            defaultValue={details.windowDays ?? 30}
          />
        </label>
        <label>
          Compare with
          <select
            name="comparison"
            defaultValue={details.comparison ?? "PREVIOUS_PERIOD"}
          >
            <option value="PREVIOUS_PERIOD">
              Equal period immediately before
            </option>
            <option value="PREVIOUS_YEAR">Same period last year</option>
          </select>
        </label>
      </details>
    </CrmForm>
  );
}
