"use client";

import { startTransition, useActionState, useState } from "react";
import { saveReportSettingsAction, type ActionState } from "@/app/actions";
import {
  RULE_FIELDS,
  RULE_FIELD_LABELS,
  defaultRules,
  newCondition,
  newRuleId,
  type ReportRule,
  type RuleCondition,
  type RuleField,
} from "@/lib/report-shared";
import type { EntryTypeDef } from "@/lib/entry-types-shared";
import { SubmitButton } from "./SubmitButton";
import { TagsField } from "./TagsField";

export function ReportSettingsForm({
  initialRules,
  tags,
  jobs,
  projects = [],
  meetingTitles = [],
  types,
}: {
  initialRules: ReportRule[];
  /** Entry types, for "Type is" conditions. */
  types: EntryTypeDef[];
  tags: string[];
  jobs: { number: string; name: string }[];
  /** Project titles, for "Project is" conditions. */
  projects?: string[];
  /** Recent meeting titles, suggested for "Meeting title contains" conditions. */
  meetingTitles?: string[];
}) {
  const [rules, setRules] = useState<ReportRule[]>(initialRules.length ? initialRules : defaultRules());
  const [state, action, pending] = useActionState<ActionState, FormData>(saveReportSettingsAction, null);

  const setRule = (id: string, patch: Partial<ReportRule>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const mapConditions = (id: string, fn: (cs: RuleCondition[]) => RuleCondition[]) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, conditions: fn(r.conditions) } : r)));
  const addCondition = (id: string) => mapConditions(id, (cs) => [...cs, newCondition()]);
  const removeCondition = (id: string, i: number) => mapConditions(id, (cs) => cs.filter((_, ci) => ci !== i));
  const setCondition = (id: string, i: number, patch: Partial<RuleCondition>) =>
    mapConditions(id, (cs) => cs.map((c, ci) => (ci === i ? { ...c, ...patch } : c)));
  const changeField = (id: string, i: number, field: RuleField) =>
    setCondition(id, i, { field, value: field === "type" ? "meeting" : field === "job" ? (jobs[0]?.number ?? "") : "" });

  const removeRule = (id: string) => setRules((rs) => rs.filter((r) => r.id !== id));
  const move = (i: number, dir: -1 | 1) =>
    setRules((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = rs.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const addRule = () => setRules((rs) => [...rs, { id: newRuleId(), conditions: [newCondition()], template: "" }]);
  // Bumped on reset so each rule's tag field (it keeps its own state) starts over.
  const [resets, setResets] = useState(0);
  const reset = () => {
    setRules(defaultRules());
    setResets((n) => n + 1);
  };

  const conditionValue = (r: ReportRule, i: number, c: RuleCondition) => {
    const onChange = (value: string) => setCondition(r.id, i, { value });
    if (c.field === "type")
      return (
        <select className="input w-24 py-1 text-sm" value={c.value} onChange={(e) => onChange(e.target.value)}>
          {c.value && !types.some((t) => t.key === c.value) && <option value={c.value}>{c.value}</option>}
          {types.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      );
    if (c.field === "tag")
      return (
        <input className="input w-28 py-1 text-sm" list="rule-tags" placeholder="Migration" value={c.value} onChange={(e) => onChange(e.target.value)} />
      );
    if (c.field === "ticket")
      return (
        <input className="input w-24 py-1 font-mono text-sm" placeholder="PROJ-" value={c.value} onChange={(e) => onChange(e.target.value)} />
      );
    if (c.field === "title")
      return (
        <input
          className="input w-56 py-1 text-sm"
          list="rule-meeting-titles"
          placeholder="PROJ | Mob Programming"
          title="Case-insensitive; matches anywhere in the meeting title (the entry's description)"
          value={c.value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    if (c.field === "project")
      return (
        <select className="input w-44 py-1 text-sm" value={c.value} onChange={(e) => onChange(e.target.value)}>
          <option value="">(any project)</option>
          {c.value && !projects.includes(c.value) && <option value={c.value}>{c.value}</option>}
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      );
    return (
      <select className="input w-44 py-1 text-sm" value={c.value} onChange={(e) => onChange(e.target.value)}>
        {jobs.length === 0 && <option value="">(no jobs)</option>}
        {jobs.map((j) => (
          <option key={j.number} value={j.number}>{j.number} — {j.name}</option>
        ))}
      </select>
    );
  };

  return (
    <form
      // Submitted by hand, not via `action`: React resets a form after an action, which snaps
      // controlled selects back to the values they showed when the page loaded.
      // The clicked button rides along, so "Save & tag existing entries" can tag older entries too.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(fd));
      }}
      className="space-y-3"
    >
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      <p className="text-xs text-zinc-500">
        Rules are tried top-down; the first whose conditions ALL match rewrites the entry&apos;s report line, and
        entries that render to the same label on a day are merged (hours summed). A rule with no conditions is a
        catch-all — keep it last. Placeholders: <code className="code">{"{ticket-nr}"}</code>{" "}
        <code className="code">{"{ticket-name}"}</code> <code className="code">{"{desc}"}</code>{" "}
        <code className="code">{"{type}"}</code> <code className="code">{"{tags}"}</code>{" "}
        <code className="code">{"{job}"}</code> <code className="code">{"{jobName}"}</code>{" "}
        <code className="code">{"{project}"}</code> (
        <code className="code">{"{ticket-nr}"}</code> is the key, <code className="code">{"{ticket-name}"}</code> the
        Jira title).
      </p>

      <datalist id="rule-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="rule-meeting-titles">
        {meetingTitles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="space-y-2">
        {rules.map((r, ri) => (
          <div key={r.id} className="space-y-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-5 text-right text-xs tabular-nums text-zinc-400">{ri + 1}</span>
              <span className="text-xs text-zinc-500">When</span>
              {r.conditions.length === 0 && <span className="text-xs italic text-zinc-400">any entry</span>}
              {r.conditions.map((c, ci) => (
                <span key={ci} className="inline-flex items-center gap-1">
                  {ci > 0 && <span className="px-0.5 text-xs font-medium text-zinc-400">and</span>}
                  <select className="input w-44 py-1 text-sm" value={c.field} onChange={(e) => changeField(r.id, ci, e.target.value as RuleField)}>
                    {RULE_FIELDS.map((f) => (
                      <option key={f} value={f}>{RULE_FIELD_LABELS[f]}</option>
                    ))}
                  </select>
                  {conditionValue(r, ci, c)}
                  <button
                    type="button"
                    onClick={() => removeCondition(r.id, ci)}
                    className="px-1 text-zinc-400 hover:text-red-500"
                    aria-label="Remove condition"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => addCondition(r.id)}>
                + and
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-400">→</span>
              <input
                className="input min-w-40 flex-1 py-1 font-mono text-sm"
                placeholder="{ticket}: {desc}"
                value={r.template}
                onChange={(e) => setRule(r.id, { template: e.target.value })}
              />
              <div className="w-48" title="Tags for the entries this rule applies to">
                <TagsField
                  key={`${r.id}:${resets}`}
                  name=""
                  compact
                  allTags={tags}
                  defaultValue={r.tags ?? []}
                  placeholder="+ tags"
                  onChange={(t) => setRule(r.id, { tags: t })}
                />
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-sm" onClick={() => move(ri, -1)} disabled={ri === 0} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className="btn btn-sm" onClick={() => move(ri, 1)} disabled={ri === rules.length - 1} aria-label="Move down">
                  ↓
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRule(r.id)} aria-label="Delete rule">
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={addRule}>
          + Add rule
        </button>
        <button type="button" className="btn btn-sm" onClick={reset}>
          Reset to defaults
        </button>
        <SubmitButton className="btn btn-primary" pendingText="Saving…" pending={pending}>
          Save report rules
        </SubmitButton>
        <SubmitButton className="btn btn-sm" pendingText="Tagging…" pending={pending} name="apply" value="1">
          Save &amp; tag existing entries
        </SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>

      <p className="text-xs text-zinc-400">
        Example: <code className="code">Job is · Interne Meetings · and · Type is · Meeting → Internal</code> above{" "}
        <code className="code">Type is · Meeting → Meetings</code> labels only that job&apos;s meetings differently;{" "}
        <code className="code">Meeting title contains · Mob Programming → Mob Programming</code> above it gives one
        meeting its own line. A rule&apos;s tags (e.g. <code className="code">#mob</code>) are added to the entries it
        applies to when they&apos;re booked or imported; <strong>Save &amp; tag existing entries</strong> adds them to
        entries you already have (it never removes tags).
      </p>
    </form>
  );
}
