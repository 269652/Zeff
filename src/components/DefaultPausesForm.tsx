"use client";

import { useRef, useState, useTransition } from "react";
import { saveDefaultPausesAction, type ActionState } from "@/app/actions";
import { formatHours } from "@/lib/format";
import { parsePauses, totalPauseHours } from "@/lib/pauses-shared";
import { useLockedBreakText } from "./useLockedBreakText";

/** The default break window(s) on workdays, and whether the Punch export records it. */
export function DefaultPausesForm({ text, exportToPunch, punchOn = true }: { text: string; exportToPunch: boolean; punchOn?: boolean }) {
  // Changing a start or end moves that break; its length stays.
  const draftRef = useRef<HTMLInputElement>(null);
  const draftField = useLockedBreakText(text, "12:00", draftRef);
  const draft = draftField.text;
  const [toPunch, setToPunch] = useState(exportToPunch);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const preview = parsePauses(draft);

  return (
    <form
      // Submitted by hand, not via `action`: React resets a form after an action, which would
      // snap the controlled fields back to the values they had when the page loaded.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => setState(await saveDefaultPausesAction(null, fd)));
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="defaultPauses">Default break</label>
          <input
            ref={draftRef}
            id="defaultPauses"
            name="defaultPauses"
            className="input w-56 font-mono"
            placeholder="12:00-13:00"
            value={draft}
            onChange={(e) => {
              draftField.onChange(e);
              setState(null);
            }}
          />
        </div>
        <p className={`pb-2 text-sm ${preview.ok ? "text-zinc-500" : "text-red-600 dark:text-red-400"}`}>
          {!preview.ok
            ? preview.error
            : preview.pauses.length
              ? `${preview.pauses.map((p) => `${p.start}–${p.end}`).join(", ")} · ${formatHours(totalPauseHours(preview.pauses))} h`
              : "No default break"}
        </p>
      </div>
      {/* Without the Punch plugin: not offered — what's set stays (sent along unseen). */}
      {!punchOn && toPunch && <input type="hidden" name="punchDefaultPauses" value="on" />}
      {punchOn && <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="punchDefaultPauses"
          checked={toPunch}
          onChange={(e) => {
            setToPunch(e.target.checked);
            setState(null);
          }}
          className="size-4 accent-indigo-600"
        />
        Record the default break in Punch on workdays without an entered break
      </label>}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || !preview.ok}>
          {pending ? "Saving…" : "Save default break"}
        </button>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
