"use client";

import Link from "next/link";
import { openSearch } from "@/lib/search/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { setNavHiddenAction, favoriteOrderAction, archivePageAction, restorePageAction, createPageAction, createSourceDatabaseAction, duplicatePageAction, movePageAction, saveAsTemplateAction, savePageAction, installPackageAction, setTemplateAction, templatesAction } from "../actions";
import { kindIcon, moveBefore } from "../model";
import type { TreeItem } from "../store";
import type { AppNav } from "../app-nav";
import { ChatPanel } from "./ChatPanel";
import { Dropdown, MenuItem, Modal, useSortable } from "./kit";
import { AutomationChooser } from "./AutomationChooser";
import { TemplateGallery } from "./TemplateGallery";
import "./workspace.css";

type Meta = import("../templates").TemplateMeta;

const OPEN_KEY = "zeff.workspace.open";
/** The folds of the Templates and of their built-in ones (kept with the pages' folds, below every page id). */
const TEMPLATES_FOLD = -1;
const BUILTIN_FOLD = -2;

function useOpen(): [Set<number>, (id: number, on?: boolean) => void] {
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the folds are remembered in the browser
      setOpen(new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as number[]));
    } catch {
      // nothing remembered
    }
  }, []);
  const toggle = (id: number, on?: boolean) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (on === undefined ? next.has(id) : !on) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // not remembered
      }
      return next;
    });
  return [open, toggle];
}

/** The page tree, favorites, search and "new" — the left column of the Workspace. */
export function Sidebar({ appNav = {}, items, favorites, unread = {}, channels, extSources = [], builtins = [], templateItems = [] }: { /** The navigation of app views kept in the tree (the documents' inbox, all, by type), by database id. */ appNav?: Record<number, AppNav>; /** Sources plugins bring (People …): a database of each from the New menu. */ extSources?: { id: string; label: string; icon: string }[]; /** The channels that can be sources (mail, messages) — what the New menu offers as a database of them. */ channels?: { mail: boolean; messages: boolean }; items: TreeItem[]; favorites: { id: number; title: string; icon: string; kind: string }[]; /** Mail databases' unread rows, by id. */ unread?: Record<number, number>; /** The built-in templates (read only — opened as a preview). */ builtins?: Pick<Meta, "key" | "name" | "icon" | "kind" | "category">[]; /** Your templates' pages (each marked a template, with what is below it). */ templateItems?: TreeItem[] }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const current = Number(/^\/workspace\/(\d+)/.exec(path)?.[1] ?? 0) || null;
  const builtinOpen = path.startsWith("/workspace/templates/") ? decodeURIComponent(path.slice("/workspace/templates/".length)) : null;
  const [open, toggle] = useOpen();
  const [showHidden, setShowHidden] = useState<Set<number>>(new Set());
  const navParam = useSearchParams().get("nav");
  const [templates, setTemplates] = useState<Meta[] | null>(null);
  const [automation, setAutomation] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: number; where: "before" | "into" | "after" } | null>(null);
  const dragging = useRef<number | null>(null);
  // The favorites: dragged into the order you want (shown at once, saved a moment later).
  const [favOrder, setFavOrder] = useState<number[] | null>(null);
  const favs = favOrder ? [...favorites].sort((a, b) => favOrder.indexOf(a.id) - favOrder.indexOf(b.id)) : favorites;
  const favSort = useSortable((from, to, after) => {
    const ids = favs.map((f) => f.id);
    const next = moveBefore(ids.map(String), from, to, after).map(Number);
    setFavOrder(next);
    void favoriteOrderAction(next).then(() => router.refresh());
  }, "y", "text/ws-fav");

  const byParent = useMemo(() => {
    const m = new Map<number | null, TreeItem[]>();
    for (const i of items) m.set(i.parentId, [...(m.get(i.parentId) ?? []), i]);
    return m;
  }, [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const tplByParent = useMemo(() => {
    const m = new Map<number | null, TreeItem[]>();
    for (const i of templateItems) m.set(i.parentId, [...(m.get(i.parentId) ?? []), i]);
    return m;
  }, [templateItems]);
  const tplById = useMemo(() => new Map(templateItems.map((i) => [i.id, i])), [templateItems]);

  // The path to the open page is unfolded (one of your templates, or a built-in one previewed: the Templates too).
  useEffect(() => {
    if (builtinOpen) [TEMPLATES_FOLD, BUILTIN_FOLD].forEach((f) => toggle(f, true));
    if (!current) return;
    const tpl = tplById.has(current);
    if (tpl) toggle(TEMPLATES_FOLD, true);
    const of = tpl ? tplById : byId;
    let at = of.get(current)?.parentId ?? null;
    const seen = new Set<number>();
    while (at && !seen.has(at)) {
      seen.add(at);
      toggle(at, true);
      at = of.get(at)?.parentId ?? null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, byId, tplById, builtinOpen]);

  const create = async (v: Parameters<typeof createPageAction>[0]) => {
    const r = await createPageAction(v);
    if (!r.ok) return toast(r.error, { tone: "error" });
    if (v.parentId) toggle(v.parentId, true);
    router.push(`/workspace/${r.id}`);
    router.refresh();
  };

  const drop = async (target: TreeItem, where: "before" | "into" | "after") => {
    const id = dragging.current;
    dragging.current = null;
    setOver(null);
    if (!id || id === target.id) return;
    const inTpl = tplById.has(target.id);
    let parentId: number | null;
    let before: number | null = null;
    if (where === "into") parentId = target.id;
    else {
      parentId = target.parentId;
      if (where === "before") before = target.id;
      else {
        const sibs = (inTpl ? tplByParent : byParent).get(target.parentId) ?? [];
        before = sibs[sibs.findIndex((s) => s.id === target.id) + 1]?.id ?? null;
      }
    }
    const r = await movePageAction(id, parentId, before);
    if (!r.ok) toast(r.error, { tone: "error" });
    else {
      if (parentId) toggle(parentId, true);
      // Onto the templates' top: one of yours; a template of yours into the pages: a page again.
      if (inTpl ? parentId === null && !tplById.get(id)?.template : tplById.get(id)?.template) await setTemplate(id, inTpl);
    }
    router.refresh();
  };
  const setTemplate = async (id: number, on: boolean) => {
    const r = await setTemplateAction(id, on);
    if (!r.ok) toast(r.error, { tone: "error" });
    if (on) toggle(TEMPLATES_FOLD, true);
    router.refresh();
  };
  // A page dragged onto the Templates (or into the empty part of the pages): into your templates, or out of them.
  const dropTo = (e: React.DragEvent, on: boolean) => {
    if (e.target !== e.currentTarget || !dragging.current) return;
    e.preventDefault();
    const id = dragging.current;
    dragging.current = null;
    if (on) void setTemplate(id, true);
    else void movePageAction(id, null).then(() => (tplById.get(id)?.template ? setTemplate(id, false) : router.refresh()));
  };

  // An app's navigation under its database: links to its entries; one is hidden (and shown again), never deleted.
  const navEntries = (dbId: number, nav: AppNav, depth: number): React.ReactNode => {
    const shown = showHidden.has(dbId);
    const hiddenN = nav.entries.filter((e) => e.hidden).length;
    const set = async (entry: string, hidden: boolean) => {
      const r = await setNavHiddenAction(dbId, nav.viewId, entry, hidden);
      if (!r.ok) toast(r.error, { tone: "error" });
      router.refresh();
    };
    let group = "";
    return (
      <>
        {nav.entries.filter((e) => shown || !e.hidden).map((e) => {
          const heading = e.group && e.group !== group ? e.group : "";
          group = e.group ?? group;
          return (
            <li key={`nav-${dbId}-${e.id}`} data-nav-entry={e.id}>
              {heading && <div className="px-2 pt-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase" style={{ paddingLeft: `${depth * 0.9 + 1.4}rem` }}>{heading}</div>}
              <div className={`ws-tree-row ${e.hidden ? "opacity-50" : ""}`} data-active={e.href ? e.href === `/workspace/${current}` : current === dbId && (navParam ?? "inbox") === e.id} style={{ paddingLeft: `${depth * 0.9 + 1.4}rem` }}>
                <Link href={e.href ?? `/workspace/${dbId}?nav=${encodeURIComponent(e.id)}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
                  <span className="shrink-0">{e.icon}</span>
                  <span className="truncate">{e.label}</span>
                  {e.n > 0 && <span className={`ml-auto shrink-0 pl-1 text-xs tabular-nums ${e.id === "inbox" ? "font-semibold text-indigo-600 dark:text-indigo-400" : "text-zinc-400"}`}>{e.n}</span>}
                </Link>
                <span data-hover className="flex shrink-0 items-center">
                  <button type="button" className="icon-btn size-6 text-xs" title={e.hidden ? t("Show again") : t("Hide")} aria-label={e.hidden ? t("Show again") : t("Hide")} onClick={() => void set(e.id, !e.hidden)}>
                    {e.hidden ? "👁" : "🚫"}
                  </button>
                </span>
              </div>
            </li>
          );
        })}
        {hiddenN > 0 && (
          <li>
            <button type="button" className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" style={{ paddingLeft: `${depth * 0.9 + 1.4}rem` }} onClick={() => setShowHidden((cur) => { const n = new Set(cur); if (n.has(dbId)) n.delete(dbId); else n.add(dbId); return n; })}>
              {shown ? t("Hide the hidden") : t("{n} hidden", { n: hiddenN })}
            </button>
          </li>
        )}
      </>
    );
  };

  const node = (item: TreeItem, depth: number): React.ReactNode => {
    const inTpl = tplById.has(item.id);
    const kids = (inTpl ? tplByParent : byParent).get(item.id) ?? [];
    const isOpen = open.has(item.id);
    return (
      <li key={item.id}>
        <div
          className="ws-tree-row"
          data-active={item.id === current}
          data-over={over?.id === item.id && over.where === "into" ? "true" : undefined}
          style={{ paddingLeft: `${depth * 0.9 + 0.1}rem`, boxShadow: over?.id === item.id && over.where !== "into" ? `inset 0 ${over.where === "before" ? "2px" : "-2px"} 0 var(--color-indigo-400, #818cf8)` : undefined }}
          draggable
          onDragStart={(e) => ((dragging.current = item.id), e.dataTransfer.setData("text/ws-page", String(item.id)))}
          onDragOver={(e) => {
            if (dragging.current === null) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            setOver({ id: item.id, where: y < 0.28 ? "before" : y > 0.72 ? "after" : "into" });
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            void drop(item, over?.id === item.id ? over.where : "into");
          }}
        >
          <button type="button" className="icon-btn size-6 shrink-0 text-xs" onClick={() => toggle(item.id)} aria-label={isOpen ? t("Collapse") : t("Expand")} aria-expanded={isOpen} style={{ visibility: kids.length || appNav[item.id] ? "visible" : "hidden" }}>
            {isOpen ? "▾" : "▸"}
          </button>
          <Link href={`/workspace/${item.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
            <span className="shrink-0">{item.icon || kindIcon(item.kind)}</span>
            <span className="truncate">{item.title || t("Untitled")}</span>
            {/* A mail inbox's unread, as a mail client's folders show it. */}
            {(unread[item.id] ?? 0) > 0 && (
              <span className="ml-auto shrink-0 pl-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400" title={t("{n} unread", { n: unread[item.id] })} data-unread>
                {unread[item.id]}
              </span>
            )}
          </Link>
          <span data-hover className="flex shrink-0 items-center">
            <Dropdown label="⋯" title={t("More")} className="icon-btn size-6 text-xs" align="left">
              {(close) => (
                <>
                  <MenuItem
                    onClick={async () => {
                      close();
                      const r = await savePageAction(item.id, { favorite: !item.favorite });
                      if (!r.ok) toast(r.error, { tone: "error" });
                      router.refresh();
                    }}
                  >
                    {item.favorite ? `☆ ${t("Remove from favorites")}` : `★ ${t("Add to favorites")}`}
                  </MenuItem>
                  <MenuItem
                    onClick={async () => {
                      close();
                      const r = await duplicatePageAction(item.id);
                      if (r.ok) router.push(`/workspace/${r.id}`);
                      else toast(r.error, { tone: "error" });
                      router.refresh();
                    }}
                  >
                    ⧉ {t("Duplicate")}
                  </MenuItem>
                  {inTpl ? (
                    <MenuItem onClick={() => (close(), void setTemplate(item.id, false))}>↩ {t("Remove from templates")}</MenuItem>
                  ) : (
                    !item.system && (
                      <MenuItem
                        onClick={async () => {
                          close();
                          const r = await saveAsTemplateAction(item.id);
                          if (!r.ok) return toast(r.error, { tone: "error" });
                          toggle(TEMPLATES_FOLD, true);
                          router.push(`/workspace/${r.id}`);
                          router.refresh();
                        }}
                      >
                        📋 {t("Save as template")}
                      </MenuItem>
                    )
                  )}
                  {!item.system && (
                  <MenuItem
                    danger
                    onClick={async () => {
                      close();
                      const r = await archivePageAction(item.id);
                      if (!r.ok) return toast(r.error, { tone: "error" });
                      if (current === item.id) router.push("/workspace");
                      router.refresh();
                      toast(t("Moved to the trash."), {
                        action: {
                          label: t("Undo"),
                          run: async () => {
                            const back = await restorePageAction(item.id);
                            if (!back.ok) return toast(back.error, { tone: "error" });
                            router.refresh();
                          },
                        },
                      });
                    }}
                  >
                    🗑 {t("Move to trash")}
                  </MenuItem>
                  )}
                </>
              )}
            </Dropdown>
            <button type="button" className="icon-btn size-6 text-xs" aria-label={t("New sub-page")} title={t("New sub-page")} onClick={() => void create({ parentId: item.id })}>
              +
            </button>
          </span>
        </div>
        {isOpen && (kids.length > 0 || appNav[item.id]) && (
          <ul>
            {appNav[item.id] && navEntries(item.id, appNav[item.id], depth + 1)}
            {kids.map((k) => node(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const roots = byParent.get(null) ?? [];
  return (
    // The header and the search in the flow; only the tree (the explorer) below them scrolls — in its own box, the sidebar as
    // high as the window.
    <div className="flex flex-col gap-3 text-sm lg:h-[calc(100dvh-7rem)]">
      {templates && (
        <Modal title={t("Templates")} onClose={() => setTemplates(null)} wide>
          <TemplateGallery
            templates={templates}
            busy={making}
            onPick={(key) => {
              setMaking(key);
              void create({ templateKey: key }).finally(() => {
                setMaking(null);
                setTemplates(null);
              });
            }}
          />
        </Modal>
      )}
      {automation && <AutomationChooser onClose={() => setAutomation(false)} onPick={(key) => void create({ automation: key })} />}
      <div className="ws-side-head shrink-0 space-y-3">
        <div className="flex items-center gap-1">
          <Link href="/workspace" className="flex-1 text-lg font-semibold hover:underline">
            {t("Workspace")}
          </Link>
          {/* Today is the one daily place (its "Open today's note" makes the daily note). */}
          <Link href="/heute" className="btn btn-sm" title={t("Today: appointments, todos due, review, open loops")}>
            📅 {t("Today")}
          </Link>
          <Dropdown
            label="+"
            title={t("New")}
            align="right"
            className="btn btn-primary btn-sm"
          >
            {(close) => (
              <>
                <MenuItem onClick={() => (close(), void create({}))}>📄 {t("Page")}</MenuItem>
                <MenuItem onClick={() => (close(), void create({ kind: "database", title: t("Database") }))}>🗂️ {t("Database")}</MenuItem>
                <MenuItem onClick={() => (close(), void create({ kind: "form", title: t("Form") }))}>📝 {t("Form")}</MenuItem>
                <MenuItem onClick={() => (close(), setAutomation(true))}>⚙️ {t("Automation …")}</MenuItem>
                {((channels && (channels.mail || channels.messages)) || extSources.length > 0) && (
                  <>
                    <div className="px-2 pt-1 text-xs font-semibold text-zinc-500 uppercase">{t("From channels")}</div>
                    {(
                      [
                        ...extSources.map((x) => ({ k: `ext:${x.id}`, icon: x.icon, label: t(x.label) })),
                        ...(channels?.mail && channels.messages ? [{ k: "inbox", icon: "📬", label: t("Inbox") }] : []),
                        ...(channels?.mail ? [{ k: "mail", icon: "✉", label: t("Mail") }] : []),
                        ...(channels?.messages ? [{ k: "messages", icon: "💬", label: t("Chat") }] : []),
                      ]
                    ).map((c) => (
                      <MenuItem
                        key={c.k}
                        onClick={() =>
                          void (async () => {
                            close();
                            const r = await createSourceDatabaseAction(c.k);
                            if (!r.ok) return toast(r.error, { tone: "error" });
                            router.push(`/workspace/${r.id}`);
                            router.refresh();
                          })()
                        }
                      >
                        {c.icon} {c.label}
                      </MenuItem>
                    ))}
                  </>
                )}
                <MenuItem
                  onClick={() => {
                    close();
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json,application/json";
                    input.onchange = async () => {
                      const file = input.files?.[0];
                      if (!file) return;
                      const r = await installPackageAction(await file.text(), null);
                      if (!r.ok) return toast(r.error, { tone: "error" });
                      router.push(`/workspace/${r.id}`);
                      router.refresh();
                    };
                    input.click();
                  }}
                >
                  📦 {t("Import a package …")}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    void templatesAction().then((r) => setTemplates(r.ok ? r.templates : []));
                  }}
                >
                  🧩 {t("From a template …")}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>

        {/* The one search, on the Workspace: its pages, rows, templates and Kennzahlen (the filter is a click away from everything). */}
        <button
          type="button"
          onClick={() => openSearch({ filter: "workspace" })}
          aria-label={t("Search pages")}
          aria-keyshortcuts="Control+K Meta+K"
          aria-haspopup="dialog"
          className="input flex w-full items-center justify-between gap-2 text-left text-sm text-zinc-500 dark:text-zinc-400"
        >
          <span className="truncate">{t("Search pages …")}</span>
          <kbd className="shrink-0 rounded border border-zinc-300 px-1 font-mono text-[10px] dark:border-zinc-600" aria-hidden>
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="ws-side-tree min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      {favorites.length > 0 && (
        <section>
          <h2 className="mb-0.5 px-1 text-xs font-semibold text-zinc-500 uppercase">{t("Favorites")}</h2>
          <ul>
            {favs.map((f) => (
              <li key={f.id} className={favSort.mark(String(f.id))} {...favSort.handle(String(f.id))} {...favSort.target(String(f.id))}>
                <Link href={`/workspace/${f.id}`} draggable={false} className="ws-tree-row px-1.5" data-active={f.id === current}>
                  <span>{f.icon || kindIcon(f.kind)}</span>
                  <span className="truncate">{f.title || t("Untitled")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-0.5 px-1 text-xs font-semibold text-zinc-500 uppercase">{t("Pages")}</h2>
        {roots.length ? (
          // Dropped on the empty part: to the end of the top level.
          <ul onDragOver={(e) => dragging.current !== null && e.preventDefault()} onDrop={(e) => dropTo(e, false)}>
            {roots.map((r) => node(r, 0))}
          </ul>
        ) : (
          <p className="px-1 text-xs text-zinc-500">{t("No pages yet — press + to make one.")}</p>
        )}
      </section>

      {/* Every template: the built-in ones (read only, a preview each) and yours (pages like any other — dragged in or saved as one). */}
      <section aria-label={t("Templates")}>
        <div className="flex items-center" onDragOver={(e) => dragging.current !== null && e.preventDefault()} onDrop={(e) => dropTo(e, true)}>
          <button type="button" className="flex flex-1 items-center gap-1 px-1 text-left text-xs font-semibold text-zinc-500 uppercase" aria-expanded={open.has(TEMPLATES_FOLD)} onClick={() => toggle(TEMPLATES_FOLD)}>
            <span aria-hidden>{open.has(TEMPLATES_FOLD) ? "▾" : "▸"}</span>
            {t("Templates")}
          </button>
          <button type="button" className="icon-btn size-6 text-xs" aria-label={t("New template")} title={t("New template")} onClick={() => (toggle(TEMPLATES_FOLD, true), void create({ template: true, title: t("New template") }))}>
            +
          </button>
        </div>
        {open.has(TEMPLATES_FOLD) && (
          <ul>
            <li>
              <button type="button" className="ws-tree-row w-full text-zinc-500" aria-expanded={open.has(BUILTIN_FOLD)} onClick={() => toggle(BUILTIN_FOLD)}>
                <span className="grid size-6 shrink-0 place-items-center text-xs">{open.has(BUILTIN_FOLD) ? "▾" : "▸"}</span>
                <span>🔒 {t("Built-in")}</span>
              </button>
              {open.has(BUILTIN_FOLD) && (
                <ul>
                  {(
                    [
                      ["page", t("Pages")],
                      ["database", t("Databases")],
                      ["packages", t("Packages")],
                    ] as const
                  ).map(([group, label]) => {
                    const list = builtins.filter((b) => (b.category === "packages" ? "packages" : b.kind) === group);
                    return list.length ? (
                      <li key={group}>
                        <div className="pt-1 pl-8 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{label}</div>
                        <ul>
                          {list.map((b) => (
                            <li key={b.key}>
                              <Link href={`/workspace/templates/${encodeURIComponent(b.key)}`} className="ws-tree-row pl-8" data-active={builtinOpen === b.key}>
                                <span className="shrink-0">{b.icon}</span>
                                <span className="truncate">{b.name}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ) : null;
                  })}
                </ul>
              )}
            </li>
            {(tplByParent.get(null) ?? []).map((r) => node(r, 0))}
            {!tplByParent.get(null)?.length && <li className="px-2 py-0.5 text-xs text-zinc-400">{t("Yours: save a page as a template (⋯) or drag one here.")}</li>}
          </ul>
        )}
      </section>

      <Link href="/workspace/metrics" className="ws-tree-row px-1.5 text-zinc-500" data-active={path === "/workspace/metrics"}>
        📊 {t("Metrics")}
      </Link>
      <Link href="/workspace/settings/sources" className="ws-tree-row px-1.5 text-zinc-500" data-active={path.startsWith("/workspace/settings")}>
        ⚙ {t("Settings")}
      </Link>
      <Link href="/workspace/trash" className="ws-tree-row px-1.5 text-zinc-500" data-active={path === "/workspace/trash"}>
        🗑 {t("Trash")}
      </Link>
      </div>

      <ChatPanel />
    </div>
  );
}
