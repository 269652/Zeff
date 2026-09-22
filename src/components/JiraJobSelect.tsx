"use client";

import { useRef } from "react";
import { setTicketJobAction } from "@/app/actions";

export function JiraJobSelect({
  ticketKey,
  jobs,
  current,
}: {
  ticketKey: string;
  jobs: { number: string; name: string }[];
  current: string | null;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={setTicketJobAction} ref={ref}>
      <input type="hidden" name="key" value={ticketKey} />
      <select
        name="jobNumber"
        defaultValue={current ?? ""}
        className="input py-1 text-xs"
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">— job —</option>
        {jobs.map((j) => (
          <option key={j.number} value={j.number}>{j.number}</option>
        ))}
      </select>
    </form>
  );
}
