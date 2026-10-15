"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setPluginInstalledAction } from "@/app/actions";
import { EXPERIMENTAL_DISCLAIMER, pluginById, type PluginId } from "@/plugins/catalog";
import { toast } from "./Toaster";
import { useT } from "@/components/I18nProvider";
import { catalogText } from "@/plugins/catalog-text";

/** Install / uninstall a plugin — the page (and the menu) follow at once. A beta or experimental one asks first, with its warning (and the disclaimer). */
export function PluginInstallButton({ id, installed, beta, experimental }: { id: PluginId; installed: boolean; beta?: string; experimental?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn btn-sm ${installed ? "" : "btn-primary"}`}
      disabled={pending}
      aria-label={`${installed ? t("Uninstall") : t("Install")} ${catalogText(t, pluginById(id).name)}`}
      onClick={() =>
        (installed || !beta || confirmAction(`${t("Beta: {warning}", { warning: catalogText(t, beta) })}\n\n${t("Install anyway?")}`)) &&
        (installed || !experimental || confirmAction(`${t("Experimental: {warning}", { warning: catalogText(t, experimental) })}\n\n${catalogText(t, EXPERIMENTAL_DISCLAIMER)}\n\n${t("Install anyway?")}`)) &&
        start(async () => {
          const r = await setPluginInstalledAction(id, !installed);
          toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        })
      }
    >
      {pending ? "…" : installed ? t("Uninstall") : t("Install")}
    </button>
  );
}
