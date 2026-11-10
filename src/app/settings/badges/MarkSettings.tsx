"use client";

import { BadgeLookProvider, LookDot } from "@/components/BadgeLookProvider";
import { BadgeColorPicker, RestoreDefault, useAutoSave } from "@/components/BadgeSettingsKit";
import { useT } from "@/components/I18nProvider";
import { Switch } from "@/components/Switch";
import { UnseenActivityBadge } from "@/components/boards/ActivitySeen";
import { SyncIcon } from "@/components/icons";
import { DEFAULT_LOOK, type BadgeLook, type LookId } from "@/lib/badges/look";
import { saveBadgeLookAction } from "./actions";

/** One mark: on or off and its colour, with what it is. */
function MarkRow({ id, look, label, hint, kind, set }: { id: LookId; look: BadgeLook; label: string; hint: string; kind: "pill" | "dot"; set: (id: LookId, p: Partial<BadgeLook[LookId]>) => void }) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <div className="min-w-[12rem] flex-1 text-sm">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </div>
      <Switch checked={look[id].on} onChange={(on) => set(id, { on })} labelOn={t("Shown")} labelOff={t("Hidden")} label={label} />
      <BadgeColorPicker value={look[id].color} onChange={(color) => set(id, { color })} label={t("Colour of {part}", { part: label })} kind={kind} disabled={!look[id].on} />
    </li>
  );
}

/**
 * Settings → Badges: the small marks — the Todos page's count of unseen activity (one section), the header's dots (another) — each on or
 * off in its colour, with a preview drawn by the same components. `part`: which of the two this is; both save into the one look.
 */
export function MarkSettings({ initial, part }: { initial: BadgeLook; part: "todos" | "header" }) {
  const t = useT();
  const ids: LookId[] = part === "todos" ? ["todoActivity"] : ["waiting", "menu", "syncFailed", "syncUnwell"];
  // Only this section's marks are sent (the other section saves its own; the server keeps the rest).
  const { value: look, save, status } = useAutoSave(initial, (l: BadgeLook) => saveBadgeLookAction(Object.fromEntries(ids.map((id) => [id, l[id]]))));
  const set = (id: LookId, p: Partial<BadgeLook[LookId]>) => save({ ...look, [id]: { ...look[id], ...p } });
  const isDefault = ids.every((id) => JSON.stringify(look[id]) === JSON.stringify(DEFAULT_LOOK[id]));
  const restore = () => save({ ...look, ...Object.fromEntries(ids.map((id) => [id, { ...DEFAULT_LOOK[id] }])) });
  const tab = "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300";
  return (
    <div className="space-y-3">
      <BadgeLookProvider look={look}>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
          <span className="text-xs font-medium text-zinc-500">{t("Preview")}</span>
          {part === "todos" ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium tracking-wide text-zinc-600 uppercase dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
              {t("Activity")}
              <UnseenActivityBadge ids={[]} count={3} className="ml-0.5 align-[1px]" />
            </span>
          ) : (
            <>
              <span className={tab}>
                {t("Code")}
                <LookDot id="waiting" className="ml-1 inline-block size-2 rounded-full align-[1px]" aria-label={t("Waiting for you")} />
              </span>
              <span className="relative inline-flex size-9 items-center justify-center rounded-md text-zinc-600 dark:text-zinc-300" title={t("Menu")}>
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                  <path d="M3 5.5h14M3 10h14M3 14.5h14" />
                </svg>
                <LookDot id="menu" className="absolute top-1.5 right-1.5 size-1.5 rounded-full" aria-hidden />
              </span>
              <span className="relative inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-zinc-600 dark:text-zinc-300" title={t("A sync failed")}>
                <SyncIcon className="size-5" />
                {t("Sync")}
                <LookDot id="syncFailed" className="absolute top-1.5 right-1 size-1.5 rounded-full" aria-hidden />
              </span>
              <span className="relative inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-zinc-600 dark:text-zinc-300" title={t("A source isn't well")}>
                <SyncIcon className="size-5" />
                {t("Sync")}
                <LookDot id="syncUnwell" className="absolute top-1.5 right-1 size-1.5 rounded-full" aria-hidden />
              </span>
            </>
          )}
        </div>
      </BadgeLookProvider>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {part === "todos" ? (
          <MarkRow id="todoActivity" look={look} set={set} kind="pill" label={t("Unseen activity")} hint={t("On the Todos page's Activity tab: how many changes to your todos you haven't seen yet.")} />
        ) : (
          <>
            <MarkRow id="waiting" look={look} set={set} kind="dot" label={t("Waiting for you")} hint={t("A dot on a tab where something waits for you — a Code session's question or turn.")} />
            <MarkRow id="menu" look={look} set={set} kind="dot" label={t("You are in the menu")} hint={t("A dot on the ☰ button while the open page is one of the menu's.")} />
            <MarkRow id="syncFailed" look={look} set={set} kind="dot" label={t("A sync failed")} hint={t("A dot on the Sync button when a sync failed last time.")} />
            <MarkRow id="syncUnwell" look={look} set={set} kind="dot" label={t("A source isn't well")} hint={t("A dot on the Sync button when a source keeps failing or is slow.")} />
          </>
        )}
      </ul>
      <RestoreDefault isDefault={isDefault} onRestore={restore} status={status} />
    </div>
  );
}
