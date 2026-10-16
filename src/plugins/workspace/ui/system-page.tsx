"use client";

import { useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { resetSystemPageAction, systemPageAction } from "../actions";

type Info = { kind: string; title: string; uses: string; modified: boolean; resettable: boolean };

/** Over a system page: what it is and what uses it, that it stays — changed from its default: back to it. */
export function SystemPageBar({ pageId }: { pageId: number }) {
  const t = useT();
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    void systemPageAction(pageId).then((r) => r.ok && setInfo(r.page));
  }, [pageId]);
  if (!info) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30" data-system-page>
      <span aria-hidden>🛠</span>
      <span className="font-medium">{t("System page")}</span>
      {info.title && <span className="text-zinc-600 dark:text-zinc-400">· {info.kind}</span>}
      {info.uses && <span className="text-zinc-600 dark:text-zinc-400">· {t("used by: {what}", { what: info.uses })}</span>}
      {info.modified && <span className="rounded bg-amber-200/70 px-1.5 text-xs dark:bg-amber-900/60">{t("changed")}</span>}
      <span className="flex-1" />
      {info.resettable && info.modified && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            if (!confirmAction(t("Back to the built-in text? Your changes on this page are gone (its history keeps them)."))) return;
            const r = await resetSystemPageAction(pageId);
            if (!r.ok) return void toast(r.error, { tone: "error" });
            // The editor reads the page again.
            window.location.reload();
          }}
        >
          ↺ {t("Reset to default")}
        </button>
      )}
    </div>
  );
}
