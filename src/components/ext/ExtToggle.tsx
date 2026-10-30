"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { setExtPluginEnabledAction } from "@/lib/ext/actions";

/**
 * Turn an external plugin on or off. Turning on asks first, naming what it may do (its manifest's
 * permissions) — a plugin that runs programs is told as what it is: with your rights.
 */
export function ExtToggle({ id, name, enabled, permissions }: { id: string; name: string; enabled: boolean; /** The permissions it asks for, in words. */ permissions: string[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn btn-sm ${enabled ? "" : "btn-primary"}`}
      disabled={pending}
      onClick={() => {
        if (!enabled) {
          const list = permissions.length ? permissions.map((p) => `• ${p}`).join("\n") : t("(nothing special)");
          if (!confirmAction(`${t("Turn on “{name}”? It may:", { name })}\n\n${list}\n\n${t("Only turn on plugins you trust.")}`)) return;
        }
        start(async () => {
          const r = await setExtPluginEnabledAction(id, !enabled);
          toast(r.ok ? (r.message ?? t("Done.")) : (r.error ?? t("Didn't work.")), { tone: r.ok ? "ok" : "error" });
          router.refresh();
        });
      }}
    >
      {pending ? "…" : enabled ? t("Turn off") : t("Turn on")}
    </button>
  );
}
