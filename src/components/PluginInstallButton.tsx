"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setPluginInstalledAction } from "@/app/actions";
import type { PluginId } from "@/plugins/catalog";
import { toast } from "./Toaster";

/** Install / uninstall a plugin — the page (and the menu) follow at once. A beta one asks first, with its warning. */
export function PluginInstallButton({ id, installed, beta }: { id: PluginId; installed: boolean; beta?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn btn-sm ${installed ? "" : "btn-primary"}`}
      disabled={pending}
      onClick={() =>
        (installed || !beta || confirm(`Beta: ${beta}\n\nInstall anyway?`)) &&
        start(async () => {
          const r = await setPluginInstalledAction(id, !installed);
          toast(r?.ok ? (r.message ?? "Done.") : (r?.error ?? "Didn't work."), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        })
      }
    >
      {pending ? "…" : installed ? "Uninstall" : "Install"}
    </button>
  );
}
