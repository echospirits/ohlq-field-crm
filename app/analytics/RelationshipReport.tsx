import { prisma } from "../../lib/prisma";
import { operationsReport } from "../../lib/crm/operationsReport";
export async function RelationshipReport({
  organizationId,
  start,
  end,
}: {
  organizationId: string;
  start: string;
  end: string;
}) {
  const r = await prisma.$transaction(
    (db) => operationsReport(db, organizationId, start, end),
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(v);
  return (
    <section className="workspace-section relationship-report" aria-labelledby="relationship-report-heading">
      <h2 id="relationship-report-heading">Relationship execution &amp; Pipeline estimates</h2>
      <p className="muted">
        All organization accounts and products. Execution uses {start}–{end}{" "}
        (UTC). Pipeline and territories show their current state; the sales
        filters above do not apply here. Private communications are excluded.
      </p>
      {r.truncated ? (
        <p role="status">
          Partial snapshot: first 5,000 status-bearing accounts.
        </p>
      ) : null}
      <div className="analytics-kpis">
        <div className="analytics-kpi">
          <span>Open Pipeline accounts</span>
          <strong>{r.forecast.accounts}</strong>
        </div>
        <div className="analytics-kpi">
          <span>Estimated value</span>
          <strong>{money(r.forecast.unweighted)}</strong>
        </div>
        <div className="analytics-kpi">
          <span>Probability-weighted estimate</span>
          <strong>{money(r.forecast.weighted)}</strong>
        </div>
      </div>
      <p>
        {r.forecast.valued} accounts have revenue estimates;{" "}
        {r.forecast.missingProbability} valued accounts have no probability and
        contribute no weighted estimate. These estimates are not observed
        revenue. Historical revenue forecast accuracy is unavailable because
        imported sales contain bottle quantities.
      </p>
      <h3>Execution by staff member</h3>
      {r.staff.length ? (
        <div className="table-scroll" role="region" aria-label="Execution by staff member" tabIndex={0}>
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col" className="numeric">Physical visits</th>
                <th scope="col" className="numeric">Team interactions</th>
                <th scope="col" className="numeric">Completed Worklist</th>
              </tr>
            </thead>
            <tbody>
              {r.staff.map((s, i) => (
                <tr key={i}>
                  <th scope="row">{s.name}</th>
                  <td className="numeric">{s.visits}</td>
                  <td className="numeric">{s.communications}</td>
                  <td className="numeric">{s.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No recorded execution in this date range.</p>
      )}
      <p className="field-note">
        Activity counts describe execution, not relationship quality or sales
        causation. Use the existing sales-following-visits analysis above for
        observed outcomes.
      </p>
      <h3>Current territory forecast</h3>
      <dl className="relationship-territories">{r.territories.map((t) => (
        <div key={t.name}>
          <dt>{t.name}</dt><dd>{t.accounts} open accounts · {money(t.weighted)} weighted</dd>
        </div>
      ))}</dl>
      <a
        className="button secondary"
        href={`/analytics/export?report=relationships&preset=custom&start=${start}&end=${end}`}
      >
        Export relationship report CSV
      </a>
    </section>
  );
}
