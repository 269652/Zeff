"use client";

import { useActionState, useState } from "react";
import { saveMeetingJobRulesAction, type ActionState } from "@/app/actions";
import type { MeetingJobRule } from "@/lib/calendar/meetings";
import { SubmitButton } from "./SubmitButton";

export function MeetingJobRulesForm({
  initialRules,
  jobs,
}: {
  initialRules: MeetingJobRule[];
  jobs: { number: string; name: string }[];
}) {
  const [rules, setRules] = useState<MeetingJobRule[]>(initialRules);
  const [state, action] = useActionState<ActionState, FormData>(saveMeetingJobRulesAction, null);

  const setRule = (i: number, patch: Partial<MeetingJobRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));
  const addRule = () => setRules((rs) => [...rs, { match: "", jobNumber: jobs[0]?.number ?? "" }]);

  if (jobs.length === 0) {
    return <p className="text-sm text-zinc-500">Create a job first — rules book meetings on a job number.</p>;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="meetingJobRules" value={JSON.stringify(rules.filter((r) => r.match.trim() && r.jobNumber))} />

      {rules.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No rules yet. Add one to auto-pick a job for meetings whose title matches — e.g. title contains{" "}
          <code className="code">Mob Programming</code> → book on your Relaunch job.
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-500">If title contains</span>
              <input
                className="input min-w-48 flex-1 py-1 text-sm"
                value={r.match}
                placeholder="Mob Programming"
                onChange={(e) => setRule(i, { match: e.target.value })}
              />
              <span className="text-sm text-zinc-500">book on</span>
              <select
                className="input min-w-44 py-1 text-sm"
                value={r.jobNumber}
                onChange={(e) => setRule(i, { jobNumber: e.target.value })}
              >
                {jobs.map((j) => (
                  <option key={j.number} value={j.number}>{j.number} — {j.name}</option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRule(i)} aria-label="Remove rule">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={addRule}>+ Add rule</button>
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">Save rules</SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        Matching is case-insensitive; the first matching rule wins. Rules pre-select the Job column on the import
        page — you can still change any meeting before booking.
      </p>
    </form>
  );
}
