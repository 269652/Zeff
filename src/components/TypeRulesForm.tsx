"use client";

import { Fragment, startTransition, useActionState, useState } from "react";
import { saveTypeRulesAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import type { EntryTypeDef } from "@/lib/entry-types-shared";
import type { TypeRule } from "@/lib/type-rules-shared";
import type { EntryType } from "@/db/schema";
import { SubmitButton } from "./SubmitButton";

const newId = () => Math.random().toString(36).slice(2, 9);

/** Rules that infer an entry's type from its job and description (first match wins). */
export function TypeRulesForm({
  initialRules,
  jobs,
  types,
}: {
  initialRules: TypeRule[];
  jobs: { number: string; name: string }[];
  types: EntryTypeDef[];
}) {
  const [rules, setRules] = useState<TypeRule[]>(initialRules);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTypeRulesAction, null);

  const setRule = (i: number, patch: Partial<TypeRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));
  const addRule = () => setRules((rs) => [...rs, { id: newId(), jobNumber: "", description: "", type: "absence" }]);

  return (
    <form
      // Submitted by hand, not via `action` (no form reset snapping the selects back); the
      // clicked button rides along so "Save & apply" can re-type existing entries too.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(fd));
      }}
      className="space-y-3"
    >
      <input type="hidden" name="typeRules" value={JSON.stringify(rules.filter((r) => r.jobNumber || r.description.trim()))} />

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_2rem] items-center gap-2">
        <span className="text-xs font-medium text-zinc-500 uppercase">When job is</span>
        <span className="text-xs font-medium text-zinc-500 uppercase">and description contains</span>
        <span className="text-xs font-medium text-zinc-500 uppercase">→ Type</span>
        <span />
        {rules.length === 0 && (
          <p className="col-span-4 text-sm text-zinc-500">
            No type rules yet — e.g. job <em>Abwesenheit</em> + description contains <code className="code">Urlaub</code> →
            Absence.
          </p>
        )}
        {rules.map((r, i) => (
          <Fragment key={r.id}>
            <select
              className="input py-1 text-sm"
              value={r.jobNumber}
              aria-label={`Type rule ${i + 1}: job`}
              onChange={(e) => setRule(i, { jobNumber: e.target.value })}
            >
              <option value="">any job</option>
              {jobs.map((j) => (
                <option key={j.number} value={j.number}>
                  {j.number} — {j.name}
                </option>
              ))}
            </select>
            <input
              className="input py-1 text-sm"
              value={r.description}
              placeholder="any description"
              aria-label={`Type rule ${i + 1}: description contains`}
              onChange={(e) => setRule(i, { description: e.target.value })}
            />
            <select
              className="input py-1 text-sm"
              value={r.type}
              aria-label={`Type rule ${i + 1}: type`}
              onChange={(e) => setRule(i, { type: e.target.value as EntryType })}
            >
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-danger w-8 justify-center px-0"
              onClick={() => removeRule(i)}
              aria-label="Remove type rule"
            >
              ✕
            </button>
          </Fragment>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={addRule}>
          + Add rule
        </button>
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" pending={pending}>
          Save type rules
        </SubmitButton>
        <SubmitButton className="btn btn-sm" pendingText="Applying…" pending={pending} name="apply" value="1">
          Save &amp; apply to existing entries
        </SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        The first matching rule wins. The new-entry form picks the inferred type as you choose a job or type a
        description (you can still change it), and agents booking without a type get it too.
      </p>
    </form>
  );
}
