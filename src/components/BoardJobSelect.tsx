"use client";

import { useRef } from "react";
import { setBoardJobAction } from "@/app/actions";

export function BoardJobSelect({
  boardId,
  jobs,
  current,
}: {
  boardId: number;
  jobs: { number: string; name: string }[];
  current: string | null;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={setBoardJobAction} ref={ref}>
      <input type="hidden" name="boardId" value={boardId} />
      <select
        name="jobNumber"
        defaultValue={current ?? ""}
        className="input py-1 text-xs"
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">— no default —</option>
        {jobs.map((j) => (
          <option key={j.number} value={j.number}>
            {j.number} — {j.name}
          </option>
        ))}
      </select>
    </form>
  );
}
