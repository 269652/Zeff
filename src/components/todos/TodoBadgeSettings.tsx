"use client";

import { useT } from "@/components/I18nProvider";
import { BadgeColorPicker, RestoreDefault, useAutoSave } from "@/components/BadgeSettingsKit";
import { Switch } from "@/components/Switch";
import { TodoBadgePill } from "@/components/TodoBadgePill";
import { DEFAULT_BADGE, type BadgeConfig, type BadgeCounts, type BadgePartId } from "@/lib/todos/badge";
import { saveTodoBadgeAction } from "@/plugins/todos/server-actions";

/** Settings → Badges: which numbers the Todos tab's badge shows, their order (↑↓) and colours — with a preview; saved as you change it. */
export function TodoBadgeSettings({ initial, counts }: { initial: BadgeConfig; counts: Omit<BadgeCounts, "activity"> }) {
  const t = useT();
  const { value: config, save, status } = useAutoSave(initial, saveTodoBadgeAction);
  const labels: Record<BadgePartId, { label: string; hint: string }> = {
    open: { label: t("Open"), hint: t("Your open todos.") },
    late: { label: t("Overdue"), hint: t("Open todos past their due date.") },
    today: { label: t("Due today"), hint: t("Open todos due today.") },
    activity: { label: t("Activity"), hint: t("Changes on your todos you haven't seen yet.") },
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= config.length) return;
    const next = [...config];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const patch = (i: number, p: Partial<BadgeConfig[number]>) => save(config.map((x, k) => (k === i ? { ...x, ...p } : x)));
  // The preview: today's real numbers, and a sample where one is 0 — so every part switched on can be seen.
  const sample: BadgeCounts = { open: counts.open || 7, late: counts.late || 2, today: counts.today || 1, activity: 3 };
  const real: BadgeCounts = { ...counts, activity: 0 };
  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_BADGE);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <span className="text-xs font-medium text-zinc-500">{t("Preview")}</span>
        <span className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          {t("Todos")}
          <TodoBadgePill config={config} counts={sample} className="ml-1 align-[1px]" />
        </span>
        <span className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          {t("Todos")}
          <TodoBadgePill config={config} counts={sample} className="ml-1 align-[1px]" />
        </span>
        <span className="text-xs text-zinc-500">
          {t("Now")}:{" "}
          <span className="inline-flex items-center">
            <TodoBadgePill config={config} counts={real} />
            {!config.some((p) => p.on && real[p.id] > 0) && <span>{t("no badge")}</span>}
          </span>
        </span>
      </div>
      <p className="text-xs text-zinc-500">{t("A number that is 0 is left out. The preview fills in sample numbers where you have none right now.")}</p>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {config.map((p, i) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
            <div className="flex flex-col">
              <button type="button" className="rounded px-1 text-xs leading-4 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move {part} up", { part: labels[p.id].label })}>
                ▲
              </button>
              <button type="button" className="rounded px-1 text-xs leading-4 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={i === config.length - 1} onClick={() => move(i, 1)} aria-label={t("Move {part} down", { part: labels[p.id].label })}>
                ▼
              </button>
            </div>
            <div className="min-w-[12rem] flex-1 text-sm">
              <span className="font-medium">{labels[p.id].label}</span>
              <span className="block text-xs text-zinc-500">{labels[p.id].hint}</span>
            </div>
            <Switch checked={p.on} onChange={(on) => patch(i, { on })} labelOn={t("Shown")} labelOff={t("Hidden")} label={labels[p.id].label} />
            <BadgeColorPicker value={p.color} onChange={(color) => patch(i, { color })} label={t("Colour of {part}", { part: labels[p.id].label })} />
          </li>
        ))}
      </ul>
      <RestoreDefault isDefault={isDefault} onRestore={() => save(DEFAULT_BADGE.map((x) => ({ ...x })))} status={status} />
    </div>
  );
}
