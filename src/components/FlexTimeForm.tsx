"use client";

import { useState, useTransition } from "react";
import { saveFlexTimeAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { DEFAULT_FLEX_COMMENT, type FlexTime } from "@/lib/schedule-shared";

/** Schedule → Flex time: which job takes a day's missing hours (Gleitzeit), and what those bookings say. */
export function FlexTimeForm({ flex, jobs }: { flex: FlexTime; jobs: { number: string; name: string }[] }) {
  const [jobNumber, setJobNumber] = useState(flex.jobNumber ?? "");
  const [comment, setComment] = useState(flex.comment);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      // Submitted by hand, not via `action`: React resets a form after an action, which would
      // snap the job back to the one the page loaded with.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => setState(await saveFlexTimeAction(null, fd)));
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <label className="label" htmlFor="flexJobNumber">Gleitzeit job</label>
          <select
            id="flexJobNumber"
            name="flexJobNumber"
            className="input"
            value={jobNumber}
            onChange={(e) => {
              setJobNumber(e.target.value);
              setState(null);
            }}
          >
            <option value="">— none (no flex-time row) —</option>
            {jobs.map((j) => (
              <option key={j.number} value={j.number}>{j.number} — {j.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="flexComment">Comment</label>
          <input
            id="flexComment"
            name="flexComment"
            className="input"
            value={comment}
            placeholder={DEFAULT_FLEX_COMMENT}
            maxLength={200}
            onChange={(e) => {
              setComment(e.target.value);
              setState(null);
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save flex time"}
        </button>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
