"use client";

import { useTransition } from "react";
import { setSafeModeAction } from "@/lib/mods/actions";

/** Leave safe mode (SafeModeBar): everything that was on before is on again. */
export function LeaveSafeModeButton({ label }: { label: string }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const r = await setSafeModeAction(false);
          if (r.ok) window.location.reload();
        })
      }
    >
      {label}
    </button>
  );
}
