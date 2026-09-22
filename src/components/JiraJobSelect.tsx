"use client";

import { useRef } from "react";
import { setTicketJobAction } from "@/app/actions";

export function JiraJobSelect({
  ticketKey,
  jobs,
  current,
  boardDefault,
}: {
  ticketKey: string;
  jobs: { number: string; name: string }[];
  current: string | null;
  /** Job name inherited from the ticket's board (shown when no explicit job is set). */
  boardDefault?: string | null;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const placeholder = boardDefault ? `↳ ${boardDefault} (board)` : "— job —";
  return (
    <form action={setTicketJobAction} ref={ref}>
      <input type="hidden" name="key" value={ticketKey} />
      <select
        name="jobNumber"
        defaultValue={current ?? ""}
        className={`input py-1 text-xs ${current ? "" : "text-zinc-500"}`}
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">{placeholder}</option>
        {jobs.map((j) => (
          <option key={j.number} value={j.number}>
            {j.number} — {j.name}
          </option>
        ))}
      </select>
    </form>
  );
}
