import { t } from "@/lib/i18n/server";
import { DemoButton } from "./DemoButton";

/** In the demo: a bar that says so — sample data, nothing sent — and the way into your own Zeff. */
export function DemoBar() {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <span>
        <b>{t("Demo")}</b> · {t("Sample data to look around in. Nothing is synced, and “Send” only shows what it would send.")}
      </span>
      <DemoButton to="own" label={t("Set up my own Zeff")} className="btn btn-primary btn-sm" />
    </div>
  );
}
