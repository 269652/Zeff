"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { archivePageAction, createPageAction, duplicatePageAction, movePageAction, savePageAction, searchAction, templatesAction, todayPageAction } from "../actions";
import type { TreeItem } from "../store";
import { ChatPanel } from "./ChatPanel";
import { Dropdown, MenuItem } from "./kit";
import "./workspace.css";

type Hit = { id: number; title: string; icon: string; kind: string; snippet: string; path: string };
type Meta = { key: string; name: string; icon: string; description: string; kind: "page" | "database" };

const OPEN_KEY = "zeff.workspace.open";

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
export function Sidebar({ items, favorites, unread = {} }: { items: TreeItem[]; favorites: { id: number; title: string; icon: string; kind: string }[]; /** Mail databases' unread rows, by id. */ unread?: Record<number, number> }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const current = Number(/^\/workspace\/(\d+)/.exec(path)?.[1] ?? 0) || null;
  const [open, toggle] = useOpen();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [templates, setTemplates] = useState<Meta[] | null>(null);
  const [over, setOver] = useState<{ id: number; where: "before" | "into" | "after" } | null>(null);
  const dragging = useRef<number | null>(null);

  const byParent = useMemo(() => {
    const m = new Map<number | null, TreeItem[]>();
    for (const i of items) m.set(i.parentId, [...(m.get(i.parentId) ?? []), i]);
    return m;
  }, [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The path to the open page is unfolded.
  useEffect(() => {
    if (!current) return;
    let at = byId.get(current)?.parentId ?? null;
    const seen = new Set<number>();
    while (at && !seen.has(at)) {
      seen.add(at);
      toggle(at, true);
      at = byId.get(at)?.parentId ?? null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, byId]);

  useEffect(() => {
    if (!q.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the results follow the words typed
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => void searchAction(q).then((r) => live && setHits(r.ok ? r.hits : [])), 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

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
    let parentId: number | null;
    let before: number | null = null;
    if (where === "into") parentId = target.id;
    else {
      parentId = target.parentId;
      if (where === "before") before = target.id;
      else {
        const sibs = byParent.get(target.parentId) ?? [];
        before = sibs[sibs.findIndex((s) => s.id === target.id) + 1]?.id ?? null;
      }
    }
    const r = await movePageAction(id, parentId, before);
    if (!r.ok) toast(r.error, { tone: "error" });
    else if (parentId) toggle(parentId, true);
    router.refresh();
  };

  const node = (item: TreeItem, depth: number): React.ReactNode => {
    const kids = byParent.get(item.id) ?? [];
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
          <button type="button" className="icon-btn size-5 shrink-0 text-xs" onClick={() => toggle(item.id)} aria-label={isOpen ? t("Collapse") : t("Expand")} aria-expanded={isOpen} style={{ visibility: kids.length ? "visible" : "hidden" }}>
            {isOpen ? "▾" : "▸"}
          </button>
          <Link href={`/workspace/${item.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
            <span className="shrink-0">{item.icon || (item.kind === "database" ? "🗂️" : "📄")}</span>
            <span className="truncate">{item.title || t("Untitled")}</span>
            {/* A mail inbox's unread, as a mail client's folders show it. */}
            {(unread[item.id] ?? 0) > 0 && (
              <span className="ml-auto shrink-0 pl-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400" title={t("{n} unread", { n: unread[item.id] })} data-unread>
                {unread[item.id]}
              </span>
            )}
          </Link>
          <span data-hover className="flex shrink-0 items-center">
            <Dropdown label="⋯" title={t("More")} className="icon-btn size-5 text-xs" align="left">
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
                  {!item.system && (
                  <MenuItem
                    danger
                    onClick={async () => {
                      close();
                      if (!confirmAction(t("Move “{title}” to the trash?", { title: item.title || t("Untitled") }))) return;
                      const r = await archivePageAction(item.id);
                      if (!r.ok) return toast(r.error, { tone: "error" });
                      if (current === item.id) router.push("/workspace");
                      router.refresh();
                    }}
                  >
                    🗑 {t("Move to trash")}
                  </MenuItem>
                  )}
                </>
              )}
            </Dropdown>
            <button type="button" className="icon-btn size-5 text-xs" aria-label={t("New sub-page")} title={t("New sub-page")} onClick={() => void create({ parentId: item.id })}>
              +
            </button>
          </span>
        </div>
        {isOpen && kids.length > 0 && <ul>{kids.map((k) => node(k, depth + 1))}</ul>}
      </li>
    );
  };

  const roots = byParent.get(null) ?? [];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-1">
        <Link href="/workspace" className="flex-1 text-lg font-semibold hover:underline">
          {t("Workspace")}
        </Link>
        <button
          type="button"
          className="btn btn-sm"
          title={t("Today's page — made at the first use, with your todos that are due")}
          onClick={async () => {
            const r = await todayPageAction();
            if (!r.ok) return toast(r.error, { tone: "error" });
            router.push(`/workspace/${r.id}`);
            router.refresh();
          }}
        >
          📅 {t("Today")}
        </button>
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
              <div className="px-2 pt-1 text-xs font-semibold text-zinc-500 uppercase">{t("From a template")}</div>
              {templates === null ? (
                <MenuItem onClick={() => void templatesAction().then((r) => setTemplates(r.ok ? r.templates : []))}>{t("Show templates …")}</MenuItem>
              ) : (
                templates.map((tp) => (
                  <MenuItem key={tp.key} onClick={() => (close(), void create({ templateKey: tp.key }))}>
                    <span>{tp.icon}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{tp.name}</span>
                    </span>
                  </MenuItem>
                ))
              )}
            </>
          )}
        </Dropdown>
      </div>

      <div className="relative">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search pages …")} aria-label={t("Search pages")} className="input w-full text-sm" />
        {hits && (
          <ul className="absolute z-40 mt-1 max-h-80 w-[min(24rem,90vw)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {hits.map((h) => (
              <li key={h.id}>
                <Link href={`/workspace/${h.id}`} className="block rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setQ("")}>
                  <span className="block truncate font-medium">
                    {h.icon || (h.kind === "database" ? "🗂️" : "📄")} {h.title || t("Untitled")}
                  </span>
                  {h.snippet && <span className="line-clamp-2 text-xs text-zinc-500">{h.snippet}</span>}
                  {h.path && <span className="block truncate text-xs text-zinc-400">{h.path}</span>}
                </Link>
              </li>
            ))}
            {!hits.length && <li className="px-2 py-1.5 text-zinc-500">{t("Nothing found")}</li>}
          </ul>
        )}
      </div>

      {favorites.length > 0 && (
        <section>
          <h2 className="mb-0.5 px-1 text-xs font-semibold text-zinc-500 uppercase">{t("Favorites")}</h2>
          <ul>
            {favorites.map((f) => (
              <li key={f.id}>
                <Link href={`/workspace/${f.id}`} className="ws-tree-row px-1.5" data-active={f.id === current}>
                  <span>{f.icon || (f.kind === "database" ? "🗂️" : "📄")}</span>
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
          <ul
            onDragOver={(e) => dragging.current !== null && e.preventDefault()}
            onDrop={(e) => {
              // Dropped on the empty part: to the end of the top level.
              if (e.target !== e.currentTarget || !dragging.current) return;
              e.preventDefault();
              const id = dragging.current;
              dragging.current = null;
              void movePageAction(id, null).then(() => router.refresh());
            }}
          >
            {roots.map((r) => node(r, 0))}
          </ul>
        ) : (
          <p className="px-1 text-xs text-zinc-500">{t("No pages yet — press + to make one.")}</p>
        )}
      </section>

      <Link href="/workspace/settings/sources" className="ws-tree-row px-1.5 text-zinc-500" data-active={path.startsWith("/workspace/settings")}>
        ⚙ {t("Settings")}
      </Link>
      <Link href="/workspace/trash" className="ws-tree-row px-1.5 text-zinc-500" data-active={path === "/workspace/trash"}>
        🗑 {t("Trash")}
      </Link>

      <ChatPanel />
    </div>
  );
}
