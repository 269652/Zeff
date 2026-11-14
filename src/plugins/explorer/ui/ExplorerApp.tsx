"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { confirmAction } from "@/components/confirm";
import { formatDateTime } from "@/lib/format";
import { sizeText } from "@/plugins/documents/shared";
import { baseName, crumbs, entryIcon, navIdOf, pathOfNav, viewKind, type Entry, type Listing, type Opened, type Places } from "../shared";
import type { ExplorerStart } from "../start";
import {
  createAction,
  importFilesAction,
  importFolderAction,
  listFolderAction,
  openFileAction,
  openHereAction,
  placesAction,
  placesInTreeAction,
  unwatchFolderAction,
  watchFolderAction,
  watchModeAction,
} from "../server-actions";
import { FileViewer } from "./FileViewer";

type SortKey = "name" | "mtime" | "type" | "size";
type Mode = "auto" | "confirm";

/**
 * The Explorer on its page in the Workspace, laid out like Windows Explorer: back / forward / up and the address bar on top, the
 * places on the left (home folders, watched folders, drives), the folder's files in the middle (sortable, filterable, several
 * picked with Ctrl / Shift), the opened file on the right. Files go into Documents from here; a folder is watched from here.
 */
export function ExplorerApp({ pageId, start }: { pageId: number; start: ExplorerStart }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [listing, setListing] = useState<Listing>(start.listing);
  const [places, setPlaces] = useState<Places>(start.places);
  const [live, setLive] = useState<string[]>(start.live);
  const [back, setBack] = useState<(string | null)[]>([]);
  const [forward, setForward] = useState<(string | null)[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [filter, setFilter] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [making, setMaking] = useState<{ kind: "folder" | "file"; name: string } | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [watchMode, setWatchMode] = useState<Mode>("confirm");
  const [showPlaces, setShowPlaces] = useState(false);
  const [inTree, setInTree] = useState(start.inTree);
  const router = useRouter();
  // A place picked in the Workspace tree: the page opens with ?nav=path:… — that folder is shown.
  const navPath = pathOfNav(useSearchParams().get("nav"));
  const handledNav = useRef<string | null>(null);

  const load = useCallback(
    (path: string | null, how: "go" | "back" | "forward" | "refresh" = "go") =>
      startTransition(async () => {
        const r = await listFolderAction(pageId, path);
        if (!r.ok) return void toast(r.error, { tone: "error" });
        if (how === "go") {
          setBack((b) => [...b, listing.path].slice(-50));
          setForward([]);
        }
        if (how !== "refresh") {
          setPicked(new Set());
          setFilter("");
        }
        setListing(r.listing);
        setAddress(null);
        setShowPlaces(false);
        // (The address follows the folder, so the tree marks the place it is in — and a reload stays there.)
        if (how !== "refresh") {
          const nav = r.listing.path ? navIdOf(r.listing.path) : null;
          handledNav.current = r.listing.path;
          window.history.replaceState(null, "", nav ? `${window.location.pathname}?nav=${encodeURIComponent(nav)}` : window.location.pathname);
        }
      }),
    [pageId, listing.path],
  );
  // (Only a new ?nav= counts — a folder opened here moves the address itself, and that is not a new pick.)
  const latest = useRef({ load, path: listing.path });
  useEffect(() => {
    latest.current = { load, path: listing.path };
  });
  useEffect(() => {
    if (!navPath || handledNav.current === navPath) return;
    handledNav.current = navPath;
    const { load: go, path } = latest.current;
    if (!path || !samePath(navPath, path)) go(navPath);
  }, [navPath]);
  const toggleTree = () =>
    startTransition(async () => {
      const r = await placesInTreeAction(pageId, !inTree);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setInTree(!inTree);
      toast(r.message, { tone: "ok" });
      router.refresh();
    });
  const reloadPlaces = () =>
    void placesAction().then((r) => {
      if (r.ok) {
        setPlaces(r.places);
        setLive(r.live);
      }
    });
  const refresh = () => {
    load(listing.path, "refresh");
    reloadPlaces();
  };
  const goBack = () => {
    if (!back.length) return;
    const to = back[back.length - 1];
    setBack(back.slice(0, -1));
    setForward([listing.path, ...forward]);
    load(to, "back");
  };
  const goForward = () => {
    if (!forward.length) return;
    const [to, ...rest] = forward;
    setForward(rest);
    setBack([...back, listing.path]);
    load(to, "forward");
  };

  const open = (e: Entry) => {
    if (e.dir) return load(e.path);
    if (opened && opened.path !== e.path && !confirmLeave()) return;
    startTransition(async () => {
      const r = await openFileAction(e.path);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setOpened(r.file);
    });
  };
  // (The viewer asks itself when it is closed; switching files asks here — it can't know.)
  const confirmLeave = () => !document.querySelector("[data-explorer-dirty]") || confirmAction(t("Close without saving your changes?"));

  const act = (f: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, then?: () => void) =>
    startTransition(async () => {
      const r = await f();
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(r.message, { tone: "ok" });
      load(listing.path, "refresh");
      reloadPlaces();
      then?.();
    });

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? listing.entries.filter((e) => e.name.toLowerCase().includes(q)) : listing.entries;
    const typeOf = (e: Entry) => (e.dir ? "" : e.name.includes(".") ? e.name.slice(e.name.lastIndexOf(".") + 1).toLowerCase() : "");
    const cmp = (a: Entry, b: Entry) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      const by =
        sort.key === "size" ? a.size - b.size : sort.key === "mtime" ? a.mtime - b.mtime : sort.key === "type" ? typeOf(a).localeCompare(typeOf(b)) : 0;
      return (by || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })) * (sort.desc ? -1 : 1);
    };
    return [...list].sort(cmp);
  }, [listing.entries, filter, sort]);

  const pick = (e: Entry, ev: MouseEvent | KeyboardEvent) => {
    const next = new Set(ev.ctrlKey || ev.metaKey ? picked : []);
    if (ev.shiftKey && anchor) {
      const a = shown.findIndex((x) => x.path === anchor);
      const b = shown.findIndex((x) => x.path === e.path);
      if (a >= 0 && b >= 0) for (const x of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.path);
    } else if ((ev.ctrlKey || ev.metaKey) && picked.has(e.path)) next.delete(e.path);
    else next.add(e.path);
    setPicked(next);
    if (!ev.shiftKey) setAnchor(e.path);
  };
  const toggle = (e: Entry) => {
    const next = new Set(picked);
    if (next.has(e.path)) next.delete(e.path);
    else next.add(e.path);
    setPicked(next);
    setAnchor(e.path);
  };

  const pickedEntries = shown.filter((e) => picked.has(e.path));
  const pickedFiles = pickedEntries.filter((e) => !e.dir);
  const pickedDir = pickedEntries.length === 1 && pickedEntries[0].dir ? pickedEntries[0] : null;
  // The folder the folder actions are about: the one picked, else the one we're in.
  const folder = pickedDir?.path ?? listing.path;
  const watched = pickedDir ? (places.watched.find((w) => samePath(w.path, pickedDir.path)) ?? null) : listing.watched;
  const watchedHere = watched && folder && samePath(watched.path, folder);
  const isLive = (p: string) => live.some((l) => samePath(l, p));

  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === "mtime" || key === "size" }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? " ▾" : " ▴") : "");

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest("input, textarea, .monaco-editor")) return;
    if (ev.key === "Backspace" || (ev.altKey && ev.key === "ArrowUp")) {
      ev.preventDefault();
      if (listing.path) load(listing.parent);
    } else if (ev.altKey && ev.key === "ArrowLeft") goBack();
    else if (ev.altKey && ev.key === "ArrowRight") goForward();
    else if (ev.key === "F5") {
      ev.preventDefault();
      refresh();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      setPicked(new Set(shown.map((e) => e.path)));
    } else if (ev.key === "Enter" && pickedEntries.length === 1) open(pickedEntries[0]);
  };

  const make = () => {
    if (!making || !listing.path) return;
    const { kind, name } = making;
    startTransition(async () => {
      const r = await createAction(listing.path!, name, kind);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setMaking(null);
      load(listing.path, "refresh");
      if (kind === "file") {
        const f = await openFileAction(r.path);
        if (f.ok) setOpened(f.file);
      }
    });
  };

  const placeList = (title: string, items: { name: string; path: string; icon: string; id?: string }[]) =>
    items.length > 0 && (
      <div className="space-y-0.5">
        <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
        {items.map((p) => (
          <button
            key={`${title}:${p.path}`}
            className={`flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${listing.path && samePath(listing.path, p.path) ? "bg-zinc-100 font-medium dark:bg-zinc-800" : ""}`}
            title={p.path}
            onClick={() => load(p.path)}
          >
            <span aria-hidden>{p.icon}</span>
            <span className="truncate">{p.name}</span>
            {p.id && isLive(p.path) && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title={t("Watched live")} />}
          </button>
        ))}
      </div>
    );

  return (
    <div className="not-prose card mb-6 flex h-[min(78vh,860px)] min-h-[480px] flex-col overflow-hidden p-0 text-sm" onKeyDown={onKey}>
      {/* Toolbar: back, forward, up, refresh, the address, the filter. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <button className={`btn btn-sm ${inTree ? "hidden" : opened ? "xl:hidden" : "md:hidden"}`} onClick={() => setShowPlaces((s) => !s)} aria-expanded={showPlaces} aria-label={t("Places")}>
          ☰
        </button>
        <button className="btn btn-sm" disabled={!back.length || pending} onClick={goBack} aria-label={t("Back")} title={`${t("Back")} (Alt+←)`}>
          ←
        </button>
        <button className="btn btn-sm" disabled={!forward.length || pending} onClick={goForward} aria-label={t("Forward")} title={`${t("Forward")} (Alt+→)`}>
          →
        </button>
        <button className="btn btn-sm" disabled={!listing.path || pending} onClick={() => load(listing.parent)} aria-label={t("Up")} title={`${t("Up")} (Alt+↑)`}>
          ↑
        </button>
        <button className="btn btn-sm" disabled={pending} onClick={refresh} aria-label={t("Refresh")} title={`${t("Refresh")} (F5)`}>
          ⟳
        </button>
        <div className="min-w-0 flex-1 basis-60">
          {address !== null ? (
            <input
              className="input w-full font-mono text-[13px]"
              autoFocus
              value={address}
              aria-label={t("Address")}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setAddress(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load(address.trim() || null);
                if (e.key === "Escape") setAddress(null);
              }}
            />
          ) : (
            <div className="input flex w-full cursor-text items-center gap-0.5 overflow-hidden whitespace-nowrap" onClick={() => setAddress(listing.path ?? "")} title={t("Click to type a path")}>
              <button className="shrink-0 hover:underline" onClick={(e) => (e.stopPropagation(), load(null))}>
                {t("This PC")}
              </button>
              {listing.path &&
                crumbs(listing.path).map((c) => (
                  <span key={c.path} className="flex shrink-0 items-center gap-0.5">
                    <span className="text-zinc-400">›</span>
                    <button className="hover:underline" onClick={(e) => (e.stopPropagation(), load(c.path))}>
                      {c.name}
                    </button>
                  </span>
                ))}
            </div>
          )}
        </div>
        <input className="input w-40" type="search" placeholder={t("Search this folder")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Search this folder")} />
        <button
          className="btn btn-sm"
          disabled={pending}
          onClick={toggleTree}
          aria-pressed={inTree}
          title={inTree ? t("Show the places beside the files again") : t("Show the places (Quick access, watched folders, drives) in Zeff's sidebar, under this page")}
        >
          {inTree ? `◧ ${t("Places here")}` : `⇤ ${t("Places in sidebar")}`}
        </button>
      </div>

      {/* What can be done here: new, import, watch, open in Windows. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        {listing.path &&
          (making ? (
            <span className="flex items-center gap-1">
              <input
                className="input w-48"
                autoFocus
                value={making.name}
                placeholder={making.kind === "folder" ? t("Folder name") : t("File name (e.g. notes.md)")}
                onChange={(e) => setMaking({ ...making, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") make();
                  if (e.key === "Escape") setMaking(null);
                }}
              />
              <button className="btn btn-sm btn-primary" disabled={pending || !making.name.trim()} onClick={make}>
                {t("Create")}
              </button>
              <button className="btn btn-sm" onClick={() => setMaking(null)}>
                {t("Cancel")}
              </button>
            </span>
          ) : (
            <>
              <button className="btn btn-sm" onClick={() => setMaking({ kind: "folder", name: "" })}>
                📁 {t("New folder")}
              </button>
              <button className="btn btn-sm" onClick={() => setMaking({ kind: "file", name: "" })}>
                📄 {t("New text file")}
              </button>
            </>
          ))}
        {pickedFiles.length > 0 && (
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(async () => importFilesAction(pickedFiles.map((f) => f.path)))}>
            📥 {pickedFiles.length === 1 ? t("Import to Documents") : t("Import {n} files to Documents", { n: pickedFiles.length })}
          </button>
        )}
        {folder && (!pickedEntries.length || pickedDir) && (
          <>
            <button
              className="btn btn-sm"
              disabled={pending}
              title={t("Every file Documents reads in this folder and its subfolders, once")}
              onClick={() => confirmAction(t("Import every readable file of “{name}” (subfolders too) into Documents?", { name: baseName(folder) })) && act(() => importFolderAction(folder))}
            >
              📥 {t("Import folder")}
            </button>
            {watchedHere ? (
              <span className="flex items-center gap-1">
                <span className="text-xs text-emerald-700 dark:text-emerald-400">👁 {isLive(watched!.path) ? t("Watched live") : t("Watched")}</span>
                <select className="input w-auto py-0.5 text-xs" value={watched!.mode} disabled={pending} aria-label={t("When the AI may read it")} onChange={(e) => act(() => watchModeAction(watched!.id, e.target.value as Mode))}>
                  <option value="confirm">{t("Wait for my confirmation")}</option>
                  <option value="auto">{t("Automatically")}</option>
                </select>
                <button className="btn btn-sm" disabled={pending} onClick={() => confirmAction(t("Stop watching “{name}”? Its documents stay in Documents.", { name: baseName(watched!.path) })) && act(() => unwatchFolderAction(watched!.id))}>
                  {t("Stop watching")}
                </button>
              </span>
            ) : watched ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400" title={watched.path}>
                👁 {t("Inside the watched folder “{name}”", { name: baseName(watched.path) })}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <button className="btn btn-sm" disabled={pending} title={t("New and changed files come into Documents by themselves")} onClick={() => act(() => watchFolderAction(folder, watchMode))}>
                  👁 {t("Watch folder")}
                </button>
                <select className="input w-auto py-0.5 text-xs" value={watchMode} onChange={(e) => setWatchMode(e.target.value as Mode)} aria-label={t("When the AI may read it")}>
                  <option value="confirm">{t("Wait for my confirmation")}</option>
                  <option value="auto">{t("Automatically")}</option>
                </select>
              </span>
            )}
            {start.canOpen && (
              <button className="btn btn-sm" disabled={pending} onClick={() => act(() => openHereAction(folder, false))}>
                🗔 {t("Open in Windows Explorer")}
              </button>
            )}
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Places: home folders, watched folders, drives (in Zeff's sidebar instead, when set so). */}
        {!inTree && <nav
          className={`${showPlaces ? "absolute inset-y-0 left-0 z-10 flex shadow-lg" : "hidden"} w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 bg-white p-1.5 dark:border-zinc-800 dark:bg-zinc-950 ${opened ? "xl:static xl:flex xl:shadow-none" : "md:static md:flex md:shadow-none"}`}
          aria-label={t("Places")}
        >
          {placeList(t("Quick access"), places.quick)}
          {placeList(t("Watched folders"), places.watched)}
          {placeList(t("This PC"), places.drives)}
        </nav>}

        {/* The folder's entries. */}
        <div className={`${opened ? "hidden lg:block lg:w-[42%] lg:min-w-[300px]" : "flex-1"} min-w-0 overflow-auto`} aria-busy={pending}>
          {start.error && listing.path === null && back.length === 0 && <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{start.error}</p>}
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-[1] bg-white text-left text-xs text-zinc-500 dark:bg-zinc-950">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="w-8 px-2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={t("Pick all")}
                    checked={shown.length > 0 && shown.every((e) => picked.has(e.path))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((x) => x.path)) : new Set())}
                  />
                </th>
                <th className="px-1 py-1.5 font-medium">
                  <button onClick={() => sortBy("name")}>{t("Name")}{arrow("name")}</button>
                </th>
                <th className={`hidden w-40 px-2 py-1.5 font-medium ${opened ? "2xl:table-cell" : "sm:table-cell"}`}>
                  <button onClick={() => sortBy("mtime")}>{t("Date modified")}{arrow("mtime")}</button>
                </th>
                <th className={`hidden w-20 px-2 py-1.5 font-medium ${opened ? "" : "md:table-cell"}`}>
                  <button onClick={() => sortBy("type")}>{t("Type")}{arrow("type")}</button>
                </th>
                <th className="w-20 px-2 py-1.5 text-right font-medium">
                  <button onClick={() => sortBy("size")}>{t("Size")}{arrow("size")}</button>
                </th>
                <th className="w-9 px-1 py-1.5" aria-label={t("In Documents")} title={t("In Documents")}>
                  📥
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const on = picked.has(e.path);
                const kind = e.dir ? "" : viewKind(e.name);
                return (
                  <tr
                    key={e.path}
                    className={`cursor-default select-none border-b border-zinc-100 dark:border-zinc-900 ${on ? "bg-sky-100 dark:bg-sky-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"} ${opened?.path === e.path ? "outline outline-1 -outline-offset-1 outline-sky-400" : ""}`}
                    onClick={(ev) => pick(e, ev)}
                    onDoubleClick={() => open(e)}
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === " ") {
                        ev.preventDefault();
                        toggle(e);
                      }
                    }}
                    aria-selected={on}
                  >
                    <td className="px-2 py-1" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={on} onChange={() => toggle(e)} aria-label={e.name} />
                    </td>
                    <td className="truncate px-1 py-1">
                      <button className="flex max-w-full items-center gap-1.5 text-left hover:underline" onClick={(ev) => (ev.stopPropagation(), open(e))} title={e.path}>
                        <span aria-hidden>{entryIcon(e)}</span>
                        <span className="truncate">{e.name}</span>
                        {e.dir && isLive(e.path) && <span className="text-xs" title={t("Watched live")}>👁</span>}
                      </button>
                    </td>
                    <td className={`hidden truncate px-2 py-1 text-xs text-zinc-500 ${opened ? "2xl:table-cell" : "sm:table-cell"}`}>{e.mtime ? formatDateTime(new Date(e.mtime).toISOString()) : ""}</td>
                    <td className={`hidden truncate px-2 py-1 text-xs text-zinc-500 ${opened ? "" : "md:table-cell"}`}>{e.dir ? t("Folder") : kind === "none" ? (e.name.includes(".") ? e.name.slice(e.name.lastIndexOf(".") + 1).toUpperCase() : t("File")) : e.name.slice(e.name.lastIndexOf(".") + 1).toUpperCase()}</td>
                    <td className="px-2 py-1 text-right text-xs tabular-nums text-zinc-500">{e.dir ? "" : sizeText(e.size)}</td>
                    <td className="px-1 py-1 text-center text-xs">
                      {e.docId !== null && <span title={e.changed ? t("In Documents — changed since") : t("In Documents")}>{e.changed ? "🟡" : "✅"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-zinc-500">{filter ? t("Nothing here matches “{q}”.", { q: filter }) : t("This folder is empty.")}</p>}
        </div>

        {opened && (
          <div className="min-w-0 flex-1 border-l border-zinc-200 dark:border-zinc-800">
            <FileViewer
              key={`${opened.path}:${opened.mtime}`}
              file={opened}
              canOpen={start.canOpen}
              onClose={() => setOpened(null)}
              onChanged={() => {
                load(listing.path, "refresh");
                void openFileAction(opened.path).then((r) => r.ok && setOpened((o) => (o && o.path === r.file.path ? { ...o, docId: r.file.docId, changed: r.file.changed } : o)));
              }}
            />
          </div>
        )}
      </div>

      {/* Status bar. */}
      <div className="flex items-center gap-3 border-t border-zinc-200 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800">
        <span>{t("{n} items", { n: listing.entries.length })}</span>
        {picked.size > 0 && <span>{t("{n} picked", { n: picked.size })}</span>}
        {listing.cut && <span className="text-amber-600">{t("Only the first 5000 entries are shown.")}</span>}
        {pending && <span className="ml-auto">{t("Loading …")}</span>}
      </div>
    </div>
  );
}

/** Two paths the same folder (Windows: case doesn't count). */
function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  return n(a) === n(b);
}
