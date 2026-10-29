"use client";

import { useRef } from "react";
import { setBoardJobAction } from "@/plugins/jira/server-actions";
import { useT } from "@/components/I18nProvider";

export function BoardJobSelect({
  boardId,
  jobs,
  current,
  boardName,
}: {
  boardId: number;
  /** For its name (a select in a table row). */
  boardName: string;
  jobs: { number: string; name: string }[];
  current: string | null;
}) {
  const t = useT();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={setBoardJobAction} ref={ref}>
      <input type="hidden" name="boardId" value={boardId} />
      <select
        name="jobNumber"
        defaultValue={current ?? ""}
        aria-label={`${t("Default job")} – ${boardName}`}
        className="input py-1 text-xs"
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">— {t("no default")} —</option>
        {jobs.map((j) => (
          <option key={j.number} value={j.number}>
            {j.number} — {j.name}
          </option>
        ))}
      </select>
    </form>
  );
}
