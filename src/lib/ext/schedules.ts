/**
 * The functions plugins want run now and then (manifest `contributes.schedules`): every minute Zeff looks, for each account, at the
 * schedules of the plugins that are on there and runs those that are due — one at a time, and a failure is logged, not repeated at once. The
 * last run of each is kept in the account (prefs). Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { getPlugin, scanPlugins } from "@/lib/ext/registry";

const LAST = "ext.schedules.last";

export type DueSchedule = { plugin: string; id: string; function: string; args: Record<string, unknown>; everyMinutes: number };

/** The schedules of the plugins that are on in this account, with the ones that are due now. */
export function dueSchedules(now = Date.now()): DueSchedule[] {
  const last = (getPref<Record<string, string>>(LAST, {}) ?? {}) as Record<string, string>;
  return scanPlugins().plugins.flatMap((p) =>
    getPlugin(p.id)?.enabled
      ? p.manifest.contributes.schedules
          .filter((s) => now - (Date.parse(last[`${p.id}.${s.id}`] ?? "") || 0) >= s.everyMinutes * 60_000)
          .map((s): DueSchedule => ({ plugin: p.id, id: s.id, function: s.function, args: s.args, everyMinutes: s.everyMinutes }))
      : [],
  );
}

/** Runs what is due for the current account; returns what ran. The time is kept before the run, so a slow or failing one is not started again at once. */
export async function runDueSchedules(now = Date.now()): Promise<{ key: string; ok: boolean; error?: string }[]> {
  const out: { key: string; ok: boolean; error?: string }[] = [];
  for (const s of dueSchedules(now)) {
    const key = `${s.plugin}.${s.id}`;
    setPref(LAST, { ...((getPref<Record<string, string>>(LAST, {}) ?? {}) as Record<string, string>), [key]: new Date(now).toISOString() });
    try {
      const { notebookEnabled } = await import("@/plugins/notebook/runtimes");
      if (!notebookEnabled()) {
        out.push({ key, ok: false, error: "running code is switched off" });
        continue;
      }
      const { runPluginFunction } = await import("@/plugins/workspace/plugin-fn");
      await runPluginFunction(s.plugin, s.function, s.args);
      out.push({ key, ok: true });
    } catch (e) {
      out.push({ key, ok: false, error: e instanceof Error ? e.message : String(e) });
      console.error(`[schedule] ${key} failed`, e);
    }
  }
  return out;
}

const g = globalThis as { __zeffScheduleTimer?: ReturnType<typeof setInterval> };

/** Starts the minute timer (once; not in tests). */
export function startScheduleTimer(): void {
  if (g.__zeffScheduleTimer || process.env.NODE_ENV === "test" || process.env.DATABASE_PATH?.includes("zeff-test-")) return;
  g.__zeffScheduleTimer = setInterval(() => {
    void (async () => {
      try {
        const { listAccounts, withAccount } = await import("@/db/accounts");
        for (const a of listAccounts()) await withAccount(a.id, () => runDueSchedules());
      } catch (e) {
        console.error("[schedule] looking at the plugins' schedules failed", e);
      }
    })();
  }, 60_000);
  g.__zeffScheduleTimer.unref?.();
}
