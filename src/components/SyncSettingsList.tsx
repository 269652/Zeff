import Link from "next/link";
import { SyncIntervalSelect } from "@/components/SyncIntervalSelect";
import { syncOverview } from "@/lib/sync/registry";
import { formatAgo, formatDate, formatTime } from "@/lib/format";
import { installedSyncSettings } from "@/plugins/sync-settings-modules";

const at = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

/** Each installed plugin's syncs and how often they run by itself (its settings module) — the Sync settings page's and the setup's. */
export function SyncSettingsList() {
  const groups = installedSyncSettings();
  const steps = new Map(syncOverview().steps.map((s) => [s.key as string, s]));
  return (
    <>
      {groups.length ? (
        groups.map(({ plugin, settings }) => (
          <section key={plugin.id} className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            <h2 className="px-4 py-2.5 text-sm font-semibold text-zinc-500">{plugin.name}</h2>
            {settings.intervals.map((i) => {
              const s = steps.get(i.key);
              return (
                <div key={i.key} id={i.key} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-80">
                    <div className="font-medium">{i.label}</div>
                    <p className="text-sm text-zinc-500">{i.what}</p>
                    <p className="text-xs text-zinc-400">
                      {[
                        i.window,
                        s?.lastAt && `last run ${formatAgo(s.lastAt)}${s.lastOk === false ? " (failed)" : ""}`,
                        s?.nextAt && `next run ${at(s.nextAt)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <SyncIntervalSelect syncKey={i.key} label={i.label} minutes={i.get()} choices={i.choices} />
                </div>
              );
            })}
            {settings.follows.map((f) => (
              <div key={f.key} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-medium text-zinc-600 dark:text-zinc-300">{f.label}</span>
                <span className="text-zinc-500">{f.follows}</span>
              </div>
            ))}
          </section>
        ))
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          None of the installed plugins brings a sync —{" "}
          <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Plugins
          </Link>
          .
        </p>
      )}
    </>
  );
}
