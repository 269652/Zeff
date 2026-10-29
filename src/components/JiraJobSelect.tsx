"use client";

import { useRef } from "react";
import { setTicketJobAction } from "@/plugins/jira/server-actions";
import { useT } from "@/components/I18nProvider";

export function JiraJobSelect({
  ticketKey,
  jobs,
  current,
  boardJob,
}: {
  ticketKey: string;
  jobs: { number: string; name: string }[];
  current: string | null;
  /** The job inherited from the ticket's (enabled) board, if any. */
  boardJob?: { number: string; name: string } | null;
}) {
  const t = useT();
  const ref = useRef<HTMLFormElement>(null);
  // Show the effective job: the explicit one, else the board default (so the
  // dropdown is never blank when a board supplies a default).
  const effective = current ?? boardJob?.number ?? "";
  const inherited = !current && !!boardJob;
  return (
    <form action={setTicketJobAction} ref={ref}>
      <input type="hidden" name="key" value={ticketKey} />
      <select
        name="jobNumber"
        defaultValue={effective}
        aria-label={`${t("Job")} – ${ticketKey}`}
        title={inherited ? t("Inherited from board ({name})", { name: boardJob!.name }) : undefined}
        className={`input py-1 text-xs ${inherited ? "text-zinc-500 italic" : ""}`}
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">{boardJob ? `— ${t("inherit board")} —` : `— ${t("job")} —`}</option>
        {jobs.map((j) => (
          <option key={j.number} value={j.number}>
            {j.number} — {j.name}
          </option>
        ))}
      </select>
    </form>
  );
}
