"use client";

import { useRef } from "react";
import { setBoardEnabledAction } from "@/app/actions";

export function BoardEnableToggle({ boardId, enabled }: { boardId: number; enabled: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={setBoardEnabledAction} ref={ref}>
      <input type="hidden" name="boardId" value={boardId} />
      <input
        type="checkbox"
        name="enabled"
        defaultChecked={enabled}
        onChange={() => ref.current?.requestSubmit()}
        className="size-4 cursor-pointer accent-indigo-600"
        aria-label="Sync this board and feed its tickets to the dropdown"
      />
    </form>
  );
}
