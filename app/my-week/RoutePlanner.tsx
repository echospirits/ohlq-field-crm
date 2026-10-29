"use client";
import { useState } from "react";
import Link from "next/link";
import { CrmForm } from "../components/CrmForm";
import { getDirectionsHref } from "../../lib/crmActionContext";
import type { RouteStop, RouteResult } from "../../lib/crm/routeProvider";
import { suggestRoute, saveRouteAction } from "./route-actions";
export function RoutePlanner({
  date,
  stops,
  omitted,
}: {
  date: string;
  stops: RouteStop[];
  omitted: number;
}) {
  const [order, setOrder] = useState(stops),
    [result, setResult] = useState<RouteResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const move = (index: number, offset: number) => {
    const next = [...order];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setOrder(next);
    setResult(null);
  };
  return (
    <details className="section-disclosure schedule-route">
      <summary>
        <strong>Plan my route</strong>
        <span className="disclosure-meta">{stops.length ? `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}` : 'No stops scheduled'}</span>
      </summary>
      <p>
        Uses your open Worklist tasks for this date. Review existing appointment
        times and business hours before following a route.
      </p>
      {omitted ? (
        <p role="status">
          {omitted} additional or unavailable stops are omitted. Review your
          full schedule.
        </p>
      ) : null}
      {!stops.length ? (
        <p>
          No account stops assigned to you on this date. Add or schedule a
          Worklist task first.
        </p>
      ) : (
        <>
          <button
            type="button"
            className="secondary"
            disabled={busy || stops.length < 3}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const suggestion = await suggestRoute(date);
                const map = new Map(stops.map((s) => [s.id, s]));
                if (
                  suggestion.ids.length !== stops.length ||
                  suggestion.ids.some((id) => !map.has(id))
                )
                  throw Error();
                setOrder(suggestion.ids.map((id) => map.get(id)!));
                setResult(suggestion);
              } catch {
                setError(
                  "Route suggestion unavailable. Keep your current order or reload the schedule.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Planning…" : "Suggest route order"}
          </button>
          {error ? <p role="alert">{error}</p> : null}
          {result ? (
            <p role="status">
              {result.note}
              {result.seconds !== null
                ? ` Estimated driving: ${Math.ceil(result.seconds / 60)} minutes.`
                : ""}
            </p>
          ) : null}
          <CrmForm
            action={saveRouteAction}
            submitLabel="Save reviewed stop order"
          >
            <input name="date" type="hidden" value={date} />
            <ol className="route-stop-list">
              {order.map((stop, i) => (
                <li key={stop.id}>
                  <input name="stopId" type="hidden" value={stop.id} />
                  <input
                    name="stopVersion"
                    type="hidden"
                    value={stop.version}
                  />
                  <strong>{stop.name}</strong>
                  <p>{stop.address}</p>
                  {stop.time !== null ? (
                    <p>
                      Appointment:{" "}
                      {String(Math.floor(stop.time / 60)).padStart(2, "0")}:
                      {String(stop.time % 60).padStart(2, "0")}
                    </p>
                  ) : null}
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={i === 0}
                      aria-label={`Move ${stop.name} earlier`}
                      onClick={() => move(i, -1)}
                    >
                      ↑ Earlier
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={i === order.length - 1}
                      aria-label={`Move ${stop.name} later`}
                      onClick={() => move(i, 1)}
                    >
                      ↓ Later
                    </button>
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      href={
                        getDirectionsHref(
                          stop.address ||
                            `${stop.coordinates?.latitude},${stop.coordinates?.longitude}`,
                        ) ?? undefined
                      }
                    >
                      Directions
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          </CrmForm>
        </>
      )}
      <p>
        <Link href="/search">Find nearby accounts</Link>
      </p>
    </details>
  );
}
