"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { todayPageAction } from "@/plugins/workspace/actions";

/** "Open today's note": the Workspace's daily note (made at the first use, with your todos due). */
export function TodayNoteLink() {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      className="block text-xs text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
      title={t("Today's page — made at the first use, with your todos that are due")}
      onClick={() =>
        start(async () => {
          const r = await todayPageAction();
          if (!r.ok) return void toast(r.error, { tone: "error" });
          router.push(`/workspace/${r.id}`);
        })
      }
    >
      📅 {t("Open today's note →")}
    </button>
  );
}
