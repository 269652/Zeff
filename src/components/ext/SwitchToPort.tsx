"use client";

import { useState, useTransition } from "react";
import { switchToPortAction } from "@/lib/ext/actions";
import { useT } from "@/components/I18nProvider";

/** On a built-in plugin's card when its port is in the plugins folder (plugins/ports.ts): switch to the plugin, settings and all. */
export function SwitchToPort({ builtin }: { builtin: string }) {
  const t = useT();
  const [said, setSaid] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
      <span>{t("This is also there as a plugin from its repository: it updates without a new Zeff, and its keys are kept encrypted. Your settings come along.")}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await switchToPortAction(builtin);
            setSaid(r.ok ? (r.message ?? "") : (r.error ?? ""));
            if (r.ok) window.location.reload();
          })
        }
      >
        {t("Switch to the plugin")}
      </button>
      {said && <span>{said}</span>}
    </div>
  );
}
