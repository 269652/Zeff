"use client";

import { useActionState, useState } from "react";
import { saveReportSettingsAction, type ActionState } from "@/app/actions";
import {
  ENTRY_TYPE_OPTIONS,
  RULE_FIELD_LABELS,
  defaultRules,
  newRuleId,
  type ReportRule,
  type RuleField,
} from "@/lib/report-shared";
import { SubmitButton } from "./SubmitButton";

const FIELD_ORDER: RuleField[] = ["tag", "ticket", "type", "job", "always"];

export function ReportSettingsForm({
  initialRules,
  tags,
  jobs,
}: {
  initialRules: ReportRule[];
  tags: string[];
  jobs: { number: string; name: string }[];
}) {
  const [rules, setRules] = useState<ReportRule[]>(initialRules.length ? initialRules : defaultRules());
  const [state, action] = useActionState<ActionState, FormData>(saveReportSettingsAction, null);

  const update = (id: string, patch: Partial<ReportRule>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => setRules((rs) => rs.filter((r) => r.id !== id));
  const move = (i: number, dir: -1 | 1) =>
    setRules((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = rs.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const add = () => setRules((rs) => [...rs, { id: newRuleId(), field: "tag", value: "", template: "" }]);
  const reset = () => setRules(defaultRules());

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      <p className="text-xs text-zinc-500">
        Rules are tried top-down; the first match rewrites the entry&apos;s report line, and entries that
        render to the same label on a day are merged (hours summed). Put specific rules (a tag or job) above
        general ones (a type). Placeholders: <code className="code">{"{ticket}"}</code>{" "}
        <code className="code">{"{desc}"}</code> <code className="code">{"{type}"}</code>{" "}
        <code className="code">{"{tags}"}</code> <code className="code">{"{job}"}</code>{" "}
        <code className="code">{"{jobName}"}</code>.
      </p>

      <datalist id="rule-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            <span className="w-5 text-right text-xs tabular-nums text-zinc-400">{i + 1}</span>
            <select
              className="input w-40 py-1 text-sm"
              value={r.field}
              onChange={(e) => {
                const field = e.target.value as RuleField;
                const value = field === "type" ? "meeting" : field === "job" ? (jobs[0]?.number ?? "") : "";
                update(r.id, { field, value });
              }}
            >
              {FIELD_ORDER.map((f) => (
                <option key={f} value={f}>
                  {RULE_FIELD_LABELS[f]}
                </option>
              ))}
            </select>

            {r.field === "type" ? (
              <select className="input w-28 py-1 text-sm" value={r.value} onChange={(e) => update(r.id, { value: e.target.value })}>
                {ENTRY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : r.field === "tag" ? (
              <input
                className="input w-32 py-1 text-sm"
                list="rule-tags"
                placeholder="Migration"
                value={r.value}
                onChange={(e) => update(r.id, { value: e.target.value })}
              />
            ) : r.field === "ticket" ? (
              <input
                className="input w-28 py-1 font-mono text-sm"
                placeholder="PROJ-"
                value={r.value}
                onChange={(e) => update(r.id, { value: e.target.value })}
              />
            ) : r.field === "job" ? (
              <select className="input w-44 py-1 text-sm" value={r.value} onChange={(e) => update(r.id, { value: e.target.value })}>
                {jobs.length === 0 && <option value="">(no jobs)</option>}
                {jobs.map((j) => (
                  <option key={j.number} value={j.number}>
                    {j.number} — {j.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="w-28 text-xs text-zinc-400">every remaining entry</span>
            )}

            <span className="text-zinc-400">→</span>
            <input
              className="input min-w-40 flex-1 py-1 font-mono text-sm"
              placeholder="{ticket}: {desc}"
              value={r.template}
              onChange={(e) => update(r.id, { template: e.target.value })}
            />

            <div className="flex items-center gap-1">
              <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label="Move down">
                ↓
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(r.id)} aria-label="Delete rule">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={add}>
          + Add rule
        </button>
        <button type="button" className="btn btn-sm" onClick={reset}>
          Reset to defaults
        </button>
        <SubmitButton className="btn btn-primary" pendingText="Saving…">
          Save report rules
        </SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>

      <p className="text-xs text-zinc-400">
        Examples: <code className="code">Has tag · Migration → [Migration] {"{ticket}: {desc}"}</code> above{" "}
        <code className="code">Type is · Ticket → {"{ticket}: {desc}"}</code> prefixes migration tickets. Since not
        all meetings share a job, <code className="code">Type is · Meeting → Meetings — {"{jobName}"}</code> keeps
        a separate “Meetings” line per job, or use <code className="code">Job is · … → Meetings</code> for one job.
      </p>
    </form>
  );
}
