"use client";

import { startTransition, useActionState, useState } from "react";
import { saveMeetingExcludeRulesAction, type ActionState } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

/** Title patterns whose imported meetings start unchecked (placeholders, reminders, blockers). */
export function MeetingExcludeRulesForm({ initialRules }: { initialRules: string[] }) {
  const [rules, setRules] = useState<string[]>(initialRules);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMeetingExcludeRulesAction, null);

  const setRule = (i: number, value: string) => setRules((rs) => rs.map((r, j) => (j === i ? value : r)));
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  return (
    <form
      // Submitted by hand, not via `action`, like the other rule forms (no form reset afterwards).
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-3"
    >
      <input type="hidden" name="meetingExcludeRules" value={JSON.stringify(rules.map((r) => r.trim()).filter(Boolean))} />

      <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2">
        <span className="text-xs font-medium text-zinc-500 uppercase">Meeting title contains</span>
        <span />
        {rules.length === 0 && (
          <p className="col-span-2 text-sm text-zinc-500">
            No exclude rules yet — add one here, or press <strong>Exclude</strong> next to a meeting on the import page.
          </p>
        )}
        {rules.map((r, i) => (
          <div key={i} className="contents">
            <input
              className="input py-1 text-sm"
              value={r}
              placeholder="Zeiten in Chrono Erfassen"
              aria-label={`Exclude rule ${i + 1}: meeting title contains`}
              onChange={(e) => setRule(i, e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm btn-danger w-8 justify-center px-0"
              onClick={() => removeRule(i)}
              aria-label="Remove exclude rule"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setRules((rs) => [...rs, ""])}>
          + Add rule
        </button>
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" pending={pending}>
          Save exclude rules
        </SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        Case-insensitive. Matching meetings still show on the import page — marked “excluded” and unticked — so you can
        tick one to book it anyway.
      </p>
    </form>
  );
}
