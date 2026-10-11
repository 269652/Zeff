"use client";

import { useState } from "react";

export type BackendOption = { id: "copilot" | "claude"; label: string; models: { value: string; label: string }[] };

/**
 * A task's CLI and model: the installed CLIs only, and the models of the one chosen (its list —
 * the model set before stays offered even when the list doesn't have it).
 */
export function BackendPicker({ task, label, backends, backend, model }: { task: string; label: string; backends: BackendOption[]; backend: string; model: string }) {
  const first = backends.find((b) => b.id === backend) ?? backends[0];
  const [chosen, setChosen] = useState(first?.id ?? "");
  const [m, setM] = useState(first?.id === backend ? model : "");
  const opt = backends.find((b) => b.id === chosen);
  const models = opt ? (opt.models.some((x) => x.value === m) || !m ? opt.models : [...opt.models, { value: m, label: `${m} (set)` }]) : [];
  if (!backends.length) return null;
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="label">{label}: CLI</span>
        <select
          name={`${task}Backend`}
          value={chosen}
          onChange={(e) => {
            setChosen(e.target.value as BackendOption["id"]);
            setM("");
          }}
          className="input"
        >
          {backends.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="label">Model</span>
        <select name={`${task}Model`} value={m} onChange={(e) => setM(e.target.value)} className="input">
          {models.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
