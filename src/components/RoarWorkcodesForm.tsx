"use client";

import { useActionState, useState } from "react";
import { saveRoarWorkcodesAction } from "@/plugins/roar/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";

/** Configure a forced Roar WorkCode per job (used by the export where a job's WorkCode is empty). */
export function RoarWorkcodesForm({
  jobs,
  current,
}: {
  jobs: { number: string; name: string }[];
  current: Record<string, string>;
}) {
  const [map, setMap] = useState<Record<string, string>>(current);
  const [state, action] = useActionState<ActionState, FormData>(saveRoarWorkcodesAction, null);
  const set = (num: string, v: string) => setMap((m) => ({ ...m, [num]: v }));
  const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => (v ?? "").trim()));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="roarWorkcodes" value={JSON.stringify(clean)} />
      <ul className="space-y-2">
        {jobs.map((j) => (
          <li key={j.number} className="flex flex-wrap items-center gap-2">
            <span className="min-w-60 text-sm">
              <span className="font-mono">{j.number}</span> <span className="text-zinc-500">{j.name}</span>
            </span>
            <input
              className="input min-w-44 py-1 text-sm"
              value={map[j.number] ?? ""}
              placeholder="auto"
              onChange={(e) => set(j.number, e.target.value)}
              aria-label={`Roar WorkCode for ${j.number}`}
            />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">Save WorkCodes</SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        Leave blank to auto-pick (your role code, else an “Absence” code). Otherwise enter a Roar WorkCode — the code
        (e.g. <code className="code">L04090</code>) or a keyword (e.g. <code className="code">ABSENCE</code>); it&apos;s
        matched against that job&apos;s own WorkCode list in Roar.
      </p>
    </form>
  );
}
