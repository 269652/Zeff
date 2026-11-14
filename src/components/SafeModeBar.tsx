import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { safeModeState } from "@/lib/kernel/safe-mode";
import { LeaveSafeModeButton } from "./LeaveSafeModeButton";

/** While Zeff is in safe mode (lib/kernel/safe-mode.ts): a bar on every page that says so, why, and how to leave it. */
export function SafeModeBar() {
  const s = safeModeState();
  if (!s.on) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <span>
        <b>🛟 {t("Safe mode")}</b> · {t("Mods, plugins and what runs by itself (flows by clock or event, routines, pipelines) are off. Your pages, their history and the AI work: repair what broke, then leave safe mode.")}
        {s.by === "auto" && s.reason ? <> {t("Why: {reason}", { reason: s.reason })}</> : null}
      </span>
      <Link href="/mods" className="underline">
        {t("Mods")}
      </Link>
      <Link href="/plugins" className="underline">
        {t("Plugins")}
      </Link>
      {s.by === "env" ? <span className="text-xs">{t("Set by ZEFF_SAFE_MODE=1: remove it and restart Zeff to leave.")}</span> : <LeaveSafeModeButton label={t("Leave safe mode")} />}
    </div>
  );
}
