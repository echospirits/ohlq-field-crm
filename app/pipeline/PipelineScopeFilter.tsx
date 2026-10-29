"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RecordPicker } from "../components/RecordPicker";
export function PipelineScopeFilter({
  territories,
  teams,
}: {
  territories: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    [q, setQ] = useState(params.get("q") ?? "");
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/pipeline?${next}`, { scroll: false });
  };
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const timer = setTimeout(() => update("q", q), 250);
    return () => clearTimeout(timer);
  }, [q, params]);
  const scopeCount = Number(Boolean(params.get("territory"))) + Number(Boolean(params.get("team")));
  return (
    <div className="pipeline-filters">
      <label>
        Find tracked account
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or city"
        />
      </label>
      <details className="pipeline-scope-details compact-details" open={scopeCount > 0}>
        <summary>Territory and team{scopeCount ? ` · ${scopeCount} active` : ''}</summary>
        <div className="pipeline-scope-options">
          <RecordPicker
            key={`territory:${params.get("territory") ?? ""}`}
            name="territory"
            label="Filter territory"
            options={territories.map((t) => ({ value: t.id, label: t.name }))}
            defaultValue={params.get("territory") ?? ""}
            placeholder="All territories"
            clearLabel="All territories"
            onChange={(id) => update("territory", id)}
          />
          <RecordPicker
            key={`team:${params.get("team") ?? ""}`}
            name="team"
            label="Filter team"
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
            defaultValue={params.get("team") ?? ""}
            placeholder="All teams"
            clearLabel="All teams"
            onChange={(id) => update("team", id)}
          />
        </div>
      </details>
    </div>
  );
}
