"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { setCollectionAction } from "@/plugins/workspace/actions";

/** A database's way into the Lage (its rows as context — the briefing and the todos come of it), switched where the matrix shows it. */
export function BriefingToggle({ dbId, on, sign, text, cls }: { dbId: number; on: boolean; sign: string; text: string; cls: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`rounded px-1.5 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${cls}`}
      disabled={pending}
      aria-pressed={on}
      title={on ? t("Into the Lage — click to take it out") : t("Not in the Lage — click to put it in")}
      onClick={() =>
        start(async () => {
          const r = await setCollectionAction(dbId, { briefing: !on });
          if (!r.ok) toast(r.error, { tone: "error" });
          router.refresh();
        })
      }
    >
      <span aria-hidden>{sign}</span> <span className="text-xs">{text}</span>
    </button>
  );
}
