"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSyncIntervalAction } from "@/app/actions";
import { minutesText } from "@/plugins/sync-settings";
import { toast } from "./Toaster";

/** How often one sync runs by itself — saved as soon as it's picked. */
export function SyncIntervalSelect({ syncKey, label, minutes, choices }: { syncKey: string; label: string; minutes: number; choices: readonly number[] }) {
  const router = useRouter();
  const [value, setValue] = useState(minutes);
  const [pending, start] = useTransition();
  const options = [...new Set([...choices, minutes])].sort((a, b) => a - b);
  return (
    <select
      className="input w-44"
      aria-label={`${label}: how often`}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const m = Number(e.target.value);
        setValue(m);
        start(async () => {
          const r = await saveSyncIntervalAction(syncKey, m);
          toast(r?.ok ? `${label}: ${r.message}` : (r?.error ?? "Didn't work."), { tone: r?.ok ? "ok" : "error" });
          if (!r?.ok) setValue(minutes);
          router.refresh();
        });
      }}
    >
      {options.map((m) => (
        <option key={m} value={m}>
          {minutesText(m)}
        </option>
      ))}
    </select>
  );
}
