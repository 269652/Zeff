"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Overlay } from "@/components/Overlay";
import { useComboboxKeys, useLatestSearch } from "@/components/Combobox";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { opensCommands, opensPalette, opensShortcuts, parseCommand, type PaletteItem } from "@/lib/palette";
import { navGroup, orderGroups, parseQuery, SEARCH_EVENT, SEARCH_SOURCES, type OpenSearch, type SearchFilter, type SearchGroup, type SearchHit } from "@/lib/search/shared";

type Answer = { key: string; groups: SearchGroup[] };
const FILTERS: SearchFilter[] = ["all", "workspace", ...SEARCH_SOURCES];

/**
 * The one search — the header's "Search", Ctrl/⌘+K (or "/" outside a field), the Workspace sidebar's field: an overlay over
 * everything (the menu's pages and settings, the Workspace's pages, rows and templates, people, todos, tickets, mails, messages,
 * documents, Kennzahlen, the commands), in groups, a filter to one source. ">" first (or Ctrl/⌘+Shift+K) lists the commands:
 * everything Zeff runs by hand (syncs, agents, automations, jobs, a new page). "?" shows the keyboard shortcuts.
 * `pages`: the same entries the menu shows, built by the header.
 */
export function Search({ pages }: { pages: PaletteItem[] }) {
  const t = useT();
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const field = useRef<HTMLInputElement>(null);
  const server = useLatestSearch<Answer>(
    async (key) => {
      const [f, ...rest] = key.split("\n");
      const r = await fetch(`/api/search?${new URLSearchParams({ q: rest.join("\n"), in: f })}`);
      return { key, groups: r.ok ? ((await r.json()) as { groups: SearchGroup[] }).groups : [] };
    },
    { key: "", groups: [] },
    { delay: 150 },
  );

  const parsed = parseQuery(q);
  const commands = parsed.commands || filter === "commands";
  // What the server is asked: the commands filter is ">" typed; the menu's pages need no server.
  const key = `${filter}\n${filter === "commands" && !parsed.commands ? `>${q}` : q}`;
  const asks = open && filter !== "nav" && (commands || parsed.words.length >= 2);

  useEffect(() => {
    if (asks) server.search(key);
    else server.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked anew when what is asked changes
  }, [asks, key]);

  const groups = useMemo(() => {
    const own = (filter === "all" || filter === "nav") && !commands && !parsed.within ? [navGroup(pages, parsed.words, filter === "nav" || !parsed.words ? 30 : 6)] : [];
    const found = asks ? server.result.groups : [];
    return orderGroups([...own, ...found]);
  }, [pages, filter, commands, parsed.words, parsed.within, asks, server.result]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  // Each group's first option's index in `flat`.
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((sum, g) => sum + g.hits.length, 0));

  const go = async (item: SearchHit | undefined) => {
    if (!item) return;
    setOpen(false);
    // A command ("zeff:sync:jira", "zeff:routine:7", "zeff:new-page" …): run here; the Workspace's open their page after.
    const cmd = parseCommand(item.href);
    if (!cmd) return router.push(item.href);
    const { what, arg } = cmd;
    if (what === "sync" || what === "sync-all") {
      const { runSyncAction, runSyncAllAction } = await import("@/app/actions");
      const r = what === "sync" ? await runSyncAction(arg) : await runSyncAllAction();
      return void (r?.ok ? toast(r.message ?? t("Done."), { tone: "ok" }) : toast(r?.error ?? t("Failed."), { tone: "error" }));
    }
    const { createPageAction, refreshPipelineAction, runRoutineAction, runJobAction, runOpenJobsAction } = await import("@/plugins/workspace/actions");
    if (what === "routine") {
      toast(t("Started: {name}", { name: item.label.replace(/^▶\s*/, "") }));
      const r = await runRoutineAction(Number(arg));
      if (!r.ok) return void toast(r.error, { tone: "error" });
      if (r.status === "failed") return void toast(r.error ?? t("Failed."), { tone: "error" });
      toast(r.status === "started" ? t("The agent is at work.") : t("Done."), { tone: "ok" });
    } else if (what === "job") {
      const r = await runJobAction(Number(arg));
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(t("The agent is at work."), { tone: "ok" });
    } else if (what === "jobs") {
      const r = await runOpenJobsAction(Number(arg));
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(t("{n} jobs started", { n: r.started }), { tone: "ok" });
      if (r.failed.length) toast(r.failed.join("\n"), { tone: "error" });
      router.push(`/workspace/${arg}`);
    } else if (what === "refresh") {
      toast(t("Reading the sources …"));
      const r = await refreshPipelineAction(Number(arg));
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(r.background ? t("the AI runs in the background") : t("Done."), { tone: "ok" });
      router.push(`/workspace/${arg}`);
    } else {
      const r = await createPageAction({ kind: what === "new-database" ? "database" : "page" });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      router.push(`/workspace/${r.id}`);
    }
  };

  const keys = useComboboxKeys({ count: flat.length, open, onPick: (i) => void go(flat[i]), wrap: true, start: 0 });
  const cur = Math.min(keys.active, flat.length - 1);

  useEffect(() => {
    const show = ({ filter: f = "all", q: text = "" }: OpenSearch) => {
      setHelp(false);
      setFilter(f);
      setQ(text);
      keys.reset();
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (opensCommands(e)) {
        e.preventDefault();
        show({ q: ">" });
      } else if (opensPalette(e)) {
        e.preventDefault();
        show({});
      } else if (opensShortcuts(e)) {
        e.preventDefault();
        setOpen(false);
        setHelp(true);
      }
    };
    const onOpen = (e: Event) => show((e as CustomEvent<OpenSearch>).detail ?? {});
    document.addEventListener("keydown", onKey);
    window.addEventListener(SEARCH_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(SEARCH_EVENT, onOpen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  const label: Record<string, string> = {
    all: t("All"),
    workspace: t("Workspace"),
    nav: t("Go to"),
    pages: t("Pages"),
    rows: t("Rows"),
    templates: t("Templates"),
    people: t("People"),
    todos: t("Todos"),
    tickets: t("Tickets"),
    mails: t("Mails"),
    messages: t("Messages"),
    documents: t("Documents"),
    metrics: t("Metrics"),
    commands: t("Commands"),
    Sync: t("Sync"),
    Agents: t("Agents"),
    Automations: t("Automations"),
    Jobs: t("Jobs"),
    Actions: t("Actions"),
  };
  // A database's rows are named after it; a command's kind and a source by their names.
  const groupLabel = (g: SearchGroup) => (g.source === "rows" ? g.label : (label[g.label] ?? label[g.source] ?? g.label));
  const busy = asks && (server.busy || server.result.key !== key);
  const list = keys.listId;
  const kbd = "rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-800";
  const shortcuts: { keys: string[]; what: string }[] = [
    { keys: ["Ctrl/⌘", "K"], what: t("Search everything") },
    { keys: ["Ctrl/⌘", "Shift", "K"], what: t("Run a command: syncs, agents, automations, jobs") },
    { keys: ["/"], what: t("Search everything (outside a text field)") },
    { keys: [">"], what: t("In the search, first: only the commands") },
    { keys: ["?"], what: t("Show these shortcuts") },
    { keys: ["↑", "↓", "Enter"], what: t("In the search: choose a result and open it") },
    { keys: ["Esc"], what: t("Close a dialog or the menu") },
    { keys: ["Tab"], what: t("Move on; the first stop skips the header to the page") },
  ];

  return (
    <>
      <Overlay open={open} onClose={() => setOpen(false)} label={t("Search")} side="center" className="max-w-2xl">
        <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <input
            ref={field}
            autoFocus
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={list}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? keys.optionId(cur) : undefined}
            aria-describedby={`${uid}-how`}
            aria-label={commands ? t("Search commands") : t("Search everything")}
            placeholder={commands ? t("Run a command: sync, agent, automation, job …") : t("Search pages, rows, people, todos, mails … (> for commands)")}
            className="input w-full"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              keys.reset();
            }}
            onKeyDown={keys.onKeyDown}
          />
          <div role="group" aria-label={t("Search in")} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  keys.reset();
                  field.current?.focus();
                }}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${filter === f ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                {label[f]}
              </button>
            ))}
          </div>
        </div>
        <div id={list} role="listbox" aria-label={t("Results")} className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((g, gi) => (
            <div key={g.key} role="group" aria-labelledby={`${uid}-g-${g.key}`} className="mb-1">
              <div id={`${uid}-g-${g.key}`} aria-hidden className="flex items-baseline justify-between px-3 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                <span className="truncate">{groupLabel(g)}</span>
                {g.total > g.hits.length && <span className="shrink-0 font-normal normal-case tabular-nums">{t("{n} of {total}", { n: g.hits.length, total: g.total })}</span>}
              </div>
              {g.hits.map((h, hi) => {
                const i = starts[gi] + hi;
                const on = i === cur;
                return (
                  <div
                    key={h.id}
                    id={keys.optionId(i)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={on}
                    onMouseMove={() => keys.setActive(i)}
                    onClick={() => void go(h)}
                    className={`flex cursor-pointer items-baseline gap-3 rounded-md px-3 py-1.5 ${on ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{h.label}</span>
                      {h.hint && <span className={`block truncate text-xs ${on ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>{h.hint}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p id={`${uid}-how`} className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400" role="status" aria-live="polite">
          {busy && !flat.length
            ? t("Searching …")
            : !flat.length
              ? parsed.words.length < 2 && !commands && filter !== "all" && filter !== "nav"
                ? t("Type two letters or more.")
                : t("No results")
              : commands
                ? t("{n} commands — ↑↓ to choose, Enter to run, Esc to close", { n: flat.length })
                : t("{n} results — ↑↓ to choose, Enter to open, Esc to close", { n: flat.length })}
        </p>
      </Overlay>
      <Overlay open={help} onClose={() => setHelp(false)} label={t("Keyboard shortcuts")} side="center" className="max-w-md">
        <div className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Keyboard shortcuts")}</h2>
          <ul className="space-y-2">
            {shortcuts.map((k) => (
              <li key={k.what} className="flex items-center justify-between gap-3 text-sm">
                <span>{k.what}</span>
                <span className="flex shrink-0 gap-1">
                  {k.keys.map((x) => (
                    <kbd key={x} className={kbd}>
                      {x}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="text-right">
            <button type="button" className="btn btn-sm" onClick={() => setHelp(false)}>
              {t("Close")}
            </button>
          </div>
        </div>
      </Overlay>
    </>
  );
}
