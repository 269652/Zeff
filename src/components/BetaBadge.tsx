import { t } from "@/lib/i18n/server";
import { catalogText } from "@/plugins/catalog-text";
import { EXPERIMENTAL_DISCLAIMER, pluginById, type PluginId } from "@/plugins/catalog";

/** "Beta": a feature that works but may break — its warning on hover. */
export function BetaBadge({ warning }: { warning?: string }) {
  return (
    <span title={warning && catalogText(t, warning)} className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200">
      {t("Beta")}
    </span>
  );
}

/** A beta feature's warning (a catalog text, shown translated), as a box. */
export function BetaWarning({ warning, className = "" }: { warning: string; className?: string }) {
  return (
    <p className={`rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100 ${className}`}>
      <span className="font-semibold">{t("Beta")} — </span>
      {catalogText(t, warning)}
    </p>
  );
}

/** "Experimental": not an official integration — its reason and the liability disclaimer on hover. */
export function ExperimentalBadge({ warning }: { warning: string }) {
  return (
    <span title={`${catalogText(t, warning)}\n\n${catalogText(t, EXPERIMENTAL_DISCLAIMER)}`} className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-rose-800 uppercase dark:bg-rose-950 dark:text-rose-200">
      {t("Experimental")}
    </span>
  );
}

/** An experimental plugin's warning (why it can break or be refused) and the disclaimer, as a box. */
export function ExperimentalWarning({ warning, className = "" }: { warning: string; className?: string }) {
  return (
    <div className={`space-y-1 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-100 ${className}`}>
      <p>
        <span className="font-semibold">{t("Experimental")} — </span>
        {catalogText(t, warning)}
      </p>
      <p className="font-medium">{catalogText(t, EXPERIMENTAL_DISCLAIMER)}</p>
    </div>
  );
}

/** The experimental warning of a plugin, where it acts (its pages) — nothing for a plugin that isn't experimental. */
export function PluginExperimental({ id, className }: { id: PluginId; className?: string }) {
  const warning = pluginById(id).experimental;
  return warning ? <ExperimentalWarning warning={warning} className={className} /> : null;
}
