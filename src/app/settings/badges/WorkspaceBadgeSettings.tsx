"use client";

import { useT } from "@/components/I18nProvider";
import { BadgeColorPicker, RestoreDefault, useAutoSave } from "@/components/BadgeSettingsKit";
import { Switch } from "@/components/Switch";
import { DEFAULT_WS_BADGES, keepParts, WS_SOURCES, WS_TONES, type WsBadgeConfig, type WsSource, type WsTone } from "@/plugins/workspace/badge-config";
import { badgeOf, sumBadges, type BadgePart } from "@/plugins/workspace/badge-shared";
import { BadgePill, TreeBadgeLook } from "@/plugins/workspace/ui/TreeBadge";
import { saveWorkspaceBadgesAction } from "./actions";

/** Settings → Badges: the Workspace tree's badges — each kind on or off and its colour, each source on or off — with a sample tree drawn as the tree draws it. */
export function WorkspaceBadgeSettings({ initial }: { initial: WsBadgeConfig }) {
  const t = useT();
  const { value: config, save, status } = useAutoSave(initial, saveWorkspaceBadgesAction);
  const tones: Record<WsTone, { label: string; hint: string; kind: "pill" | "dot" }> = {
    unread: { label: t("What waits"), hint: t("The pill with the number of what waits on a page: unread, open, due soon."), kind: "pill" },
    important: { label: t("Late or gone wrong"), hint: t("A dot in the pill when something is late or a figure needs a look — and the ☐ of late todos."), kind: "dot" },
    activity: { label: t("Changed"), hint: t("A dot where something changed since you last opened the page."), kind: "dot" },
    messages: { label: t("Messages"), hint: t("A person's unread messages (✉), a pill of their own."), kind: "pill" },
    todos: { label: t("Todos"), hint: t("Open todos about a person (☐), a pill of their own."), kind: "pill" },
  };
  const sources: Record<WsSource, { label: string; hint: string }> = {
    unread: { label: t("Unread in mail and chat databases"), hint: t("The unread rows of your mail, chat, inbox and document databases.") },
    widgets: { label: t("Widgets on a page"), hint: t("What a page's widgets report: unread mail, today's appointments, overdue payments, a figure that needs a look.") },
    dayLists: { label: t("Day lists"), hint: t("In the evening (after 18:00): what is still open on today's list.") },
    deadlines: { label: t("Dates in rows"), hint: t("Rows with a date set to remind you, near or past.") },
    rowTodos: { label: t("Todos about a person"), hint: t("Open todos that name a person (People); the overdue ones count as late.") },
    rowMessages: { label: t("A person's unread messages"), hint: t("Unread chats and mails from a person (People).") },
    rowOther: { label: t("Overdue promises"), hint: t("Promises past their day, to or from a person (People).") },
    activity: { label: t("Changes since you last opened a page"), hint: t("What a sync, a routine or the AI changed on a page since you last opened it.") },
  };
  const setTone = (id: WsTone, p: Partial<WsBadgeConfig["tones"][WsTone]>) => save({ ...config, tones: { ...config.tones, [id]: { ...config.tones[id], ...p } } });
  const setSource = (id: WsSource, on: boolean) => save({ ...config, sources: { ...config.sources, [id]: on } });
  // The sample tree: made of parts as the sources make them, let through as the settings say (as on the server).
  const of = (list: [WsSource, BadgePart[]][]) => sumBadges(list.map(([src, parts]) => badgeOf(keepParts(parts, src, config))));
  const sample = [
    { icon: "✉", title: t("Mail"), own: of([["unread", [{ tone: "unread", count: 12, label: "" }]]]) },
    { icon: "💶", title: t("Finances"), own: of([["widgets", [{ tone: "important", count: 1, label: "" }, { tone: "unread", count: 2, label: "" }]]]) },
    { icon: "📁", title: t("Projects"), own: of([["activity", [{ tone: "activity", count: 4, label: "" }]]]), below: of([["deadlines", [{ tone: "important", count: 1, label: "" }, { tone: "unread", count: 2, label: "" }]]]) },
    {
      icon: "👤",
      title: "Anna",
      own: of([
        ["rowTodos", [{ tone: "unread", count: 2, label: "", todo: true }, { tone: "important", count: 1, label: "", todo: true }]],
        ["rowMessages", [{ tone: "messages", count: 3, label: "" }]],
      ]),
    },
    { icon: "👤", title: "Ben", own: of([["rowOther", [{ tone: "important", count: 1, label: "" }]], ["deadlines", [{ tone: "unread", count: 1, label: "" }]]]) },
  ];
  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_WS_BADGES);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <span className="text-xs font-medium text-zinc-500">{t("Preview")}</span>
        <TreeBadgeLook tones={config.tones}>
          <ul className="w-64 space-y-0.5 rounded-md border border-zinc-200 bg-white p-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950" aria-label={t("A sample of the Workspace tree")} data-testid="ws-badge-preview">
            {sample.map((r) => (
              <li key={r.title} className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5">
                <span aria-hidden>{r.icon}</span>
                <span className="truncate">{r.title}</span>
                <BadgePill badge={r.own} />
                {r.below && <span className={r.own ? "shrink-0" : "ml-auto shrink-0"}><BadgePill badge={r.below} dim /></span>}
              </li>
            ))}
          </ul>
        </TreeBadgeLook>
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{t("What the badges show")}</h3>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {WS_TONES.map((id) => (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <div className="min-w-[12rem] flex-1 text-sm">
                <span className="font-medium">{tones[id].label}</span>
                <span className="block text-xs text-zinc-500">{tones[id].hint}</span>
              </div>
              <Switch checked={config.tones[id].on} onChange={(on) => setTone(id, { on })} labelOn={t("Shown")} labelOff={t("Hidden")} label={tones[id].label} />
              <BadgeColorPicker value={config.tones[id].color} onChange={(color) => setTone(id, { color })} label={t("Colour of {part}", { part: tones[id].label })} kind={tones[id].kind} disabled={!config.tones[id].on} />
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{t("What counts")}</h3>
        <p className="text-xs text-zinc-500">{t("A source switched off adds nothing to any badge — not to the page, not to what is above it.")}</p>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {WS_SOURCES.map((id) => (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <div className="min-w-[12rem] flex-1 text-sm">
                <span className="font-medium">{sources[id].label}</span>
                <span className="block text-xs text-zinc-500">{sources[id].hint}</span>
              </div>
              <Switch checked={config.sources[id]} onChange={(on) => setSource(id, on)} labelOn={t("Counted")} labelOff={t("Not counted")} label={sources[id].label} />
            </li>
          ))}
        </ul>
      </div>
      <RestoreDefault isDefault={isDefault} onRestore={() => save(structuredClone(DEFAULT_WS_BADGES))} status={status} />
    </div>
  );
}
