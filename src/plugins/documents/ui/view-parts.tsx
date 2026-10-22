"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { T } from "@/lib/i18n/shared";
import type { Row } from "@/plugins/workspace/model";
import type { ActionEnv, AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { uploadDocuments } from "../DocumentsApp";
import { DOC_KINDS_NAV } from "../nav";
import { deleteDocumentAction } from "../server-actions";
import { checkedIds, docIdOf, documentsAppData, scopeOf, scopeTab } from "../view-data";

/**
 * The documents app's view, client side: what its template reads as app.* (the documents of the scope, searched and sorted —
 * view-data.ts), its own buttons (read, unread, delete — one or the ones ticked) and the parts it is built of where the language's
 * tags aren't enough: adding files (and dropping them on the view), a thumbnail, the PDF in a frame, the box to tick, and what keeps
 * the view in step (the Workspace tree's entry, the layout remembered, the arrow keys).
 */

/** The documents of the scope the template's state says — in the Workspace tree, the entry the address asks for (?nav=). */
function useDocumentsData(props: AppViewProps, state: Record<string, string>) {
  const t = useT();
  const inTree = props.view.nav === "workspace";
  const asked = useSearchParams().get("nav");
  // ("This week" is the week of when the view was opened.)
  const [now] = useState(() => Date.now());
  const previews = props.data.extras?.previews;
  const data = useMemo(
    () => documentsAppData(props.rows, { state: inTree ? { ...state, scope: scopeTab(asked ?? "inbox") } : state, previews, t, now, inTree, locale: typeof navigator !== "undefined" ? navigator.language : undefined }),
    [props.rows, state, inTree, asked, previews, t, now],
  );
  // (t: for the buttons' own texts — the actions are no components.)
  return { data: useMemo(() => ({ ...data, t }), [data, t]), reload: props.reload };
}

const KIND_TINT: Record<string, string> = {
  pdf: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  office: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  text: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  image: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  audio: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  other: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};
const ending = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? "").toUpperCase();
const fileUrl = (id: number) => `/api/documents/${id}/file`;
const rowOf = (p: PartProps) => (p.rowId ? (p.rows.find((r) => r.id === p.rowId) ?? null) : null);
const shownOf = (app: Record<string, unknown>) => (app.shown as Row[] | undefined) ?? [];
/** The view's root (the template's): files are dropped and keys pressed on all of it, not on a part. */
const rootOf = (el: Element | null) => (el?.closest("[data-print-root]") as HTMLElement | null) ?? null;

/** Files added: the scope back to the inbox (where they come in); reading them takes a while — the rows are read again a few times. */
async function upload(p: PartProps, t: T, files: File[]) {
  if (!files.length) return;
  p.setState("busy", "true");
  const r = await uploadDocuments(files);
  p.setState("busy", "");
  if (!r.ok) return toast(r.error ?? t("That didn't work."), { tone: "error" });
  const n = r.documents?.filter((d) => d.fresh).length ?? 0;
  toast(n ? t("{n} added — being read.", { n }) : t("Already there."), { tone: "ok" });
  p.setState("scope", "inbox");
  [1500, 5000, 12000].forEach((ms) => setTimeout(p.reload, ms));
}

/** + Add files — and the whole view a place to drop them (outlined while they are dragged over). */
function AddPart(p: PartProps) {
  const t = useT();
  const ref = useRef<HTMLLabelElement>(null);
  const live = useRef(p);
  useEffect(() => {
    live.current = p;
  });
  useEffect(() => {
    const root = rootOf(ref.current);
    if (!root) return;
    const lit = (on: boolean) => ["ring-2", "ring-indigo-300/50", "rounded-xl"].forEach((c) => root.classList.toggle(c, on));
    const over = (e: DragEvent) => {
      if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      lit(true);
    };
    const leave = (e: DragEvent) => !root.contains(e.relatedTarget as Node | null) && lit(false);
    const drop = (e: DragEvent) => {
      lit(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void upload(live.current, t, files);
    };
    root.addEventListener("dragover", over);
    root.addEventListener("dragleave", leave);
    root.addEventListener("drop", drop);
    return () => {
      root.removeEventListener("dragover", over);
      root.removeEventListener("dragleave", leave);
      root.removeEventListener("drop", drop);
      lit(false);
    };
  }, [t]);
  return (
    <label ref={ref} className="btn btn-primary btn-sm cursor-pointer print:hidden">
      + {t("Add files")}
      <input type="file" multiple hidden onChange={(e) => (void upload(p, t, [...(e.target.files ?? [])]), (e.target.value = ""))} />
    </label>
  );
}

/** Draws nothing; keeps the view in step: the scope with the tree's entry, the layout remembered, the keys, the ticks of a scope. */
function SyncPart(p: PartProps) {
  const { state, app } = p;
  const inTree = p.view.nav === "workspace";
  const asked = useSearchParams().get("nav");
  const router = useRouter();
  const path = usePathname();
  const ref = useRef<HTMLSpanElement>(null);
  // (The view's setState is a new function each time it draws: effects call the latest, they don't run again for it.)
  const set = useRef(p.setState);
  useEffect(() => {
    set.current = p.setState;
  });

  // The tree's entry (the address) is the scope; one the view sets (a concept searched, files added) goes into the address.
  useEffect(() => {
    if (inTree) set.current("scope", scopeTab(asked ?? "inbox"));
  }, [inTree, asked]);
  const lastScope = useRef(state.scope);
  useEffect(() => {
    if (lastScope.current === state.scope) return;
    lastScope.current = state.scope;
    if (inTree && scopeOf(state.scope) !== (asked ?? "inbox")) router.replace(`${path}?nav=${encodeURIComponent(scopeOf(state.scope))}`, { scroll: false });
  }, [state.scope, inTree, asked, path, router]);

  // Another scope: nothing ticked any more.
  const scope = String(app.scope ?? "");
  const shownScope = useRef(scope);
  useEffect(() => {
    if (shownScope.current === scope) return;
    shownScope.current = scope;
    set.current("checked", "");
  }, [scope]);

  // The layout is remembered in the browser (read once, written when it changes after).
  const restored = useRef(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("zeff.docs.layout") === "list") set.current("layout", "list");
    } catch {
      // nothing remembered
    }
  }, []);
  useEffect(() => {
    if (!restored.current) return void (restored.current = true);
    try {
      localStorage.setItem("zeff.docs.layout", state.layout === "list" ? "list" : "grid");
    } catch {
      // not remembered
    }
  }, [state.layout]);

  // Arrow keys move through the documents, Escape closes the preview.
  const shown = shownOf(app);
  const selected = state.selected;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const root = rootOf(ref.current);
      if (!root || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable) return;
      if (el !== document.body && !root.contains(el)) return;
      const i = shown.findIndex((r) => String(r.id) === selected);
      const go = (j: number) => (e.preventDefault(), set.current("selected", shown[j] ? String(shown[j].id) : ""));
      if (e.key === "Escape" && selected) set.current("selected", "");
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") go(Math.min(shown.length - 1, i + 1));
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(Math.max(0, i - 1));
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [shown, selected]);
  return <span ref={ref} hidden />;
}

/** The picture of an image (while it loads), else the type's colour, icon and file ending. */
function Thumb({ row, big }: { row: Row; big: boolean }) {
  const [broken, setBroken] = useState(false);
  const kind = String(row.cells.dockind ?? "other");
  const k = DOC_KINDS_NAV[kind] ?? DOC_KINDS_NAV.other;
  const t = useT();
  if (kind === "image" && !broken)
    // eslint-disable-next-line @next/next/no-img-element -- a stored file of the documents folder
    return <img src={fileUrl(docIdOf(row))} alt="" loading="lazy" className={`size-full ${big ? "object-contain" : "object-cover"}`} onError={() => setBroken(true)} />;
  return (
    <div className={`flex size-full flex-col items-center justify-center gap-1 ${KIND_TINT[kind] ?? KIND_TINT.other}`}>
      <span className={big ? "text-6xl" : "text-4xl"} aria-hidden>
        {k.icon}
      </span>
      <span className="text-[11px] font-semibold tracking-wide">{ending(row.title) || t(k.label)}</span>
    </div>
  );
}

const FRAME = "aspect-[4/3] w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800";

function ThumbPart(p: PartProps) {
  const row = rowOf(p);
  if (!row || !docIdOf(row)) return null;
  return (
    <div className={FRAME}>
      <Thumb row={row} big={p.attrs.big === "true"} />
    </div>
  );
}

function PdfPart(p: PartProps) {
  const row = rowOf(p);
  if (!row || !docIdOf(row)) return null;
  return (
    <div className={FRAME}>
      <iframe src={`${fileUrl(docIdOf(row))}#toolbar=0`} title={row.title} className="size-full bg-white" />
    </div>
  );
}

/** Open (a new tab; opening it is reading it — shown read at once) and Download. */
function FilePart(p: PartProps) {
  const t = useT();
  const row = rowOf(p);
  if (!row || !docIdOf(row)) return null;
  const url = `${fileUrl(docIdOf(row))}?open=1`;
  return (
    <>
      <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" onClick={() => row.cells.docunread === true && p.ctx?.set(row.id, "docunread", false)}>
        {t("Open")}
      </a>
      <a href={url} download={row.title} className="btn btn-sm">
        ⇩ {t("Download")}
      </a>
    </>
  );
}

/** The box to tick a document; shift-click ticks the ones between it and the one ticked last (as they are shown). */
function CheckPart(p: PartProps) {
  const t = useT();
  const row = rowOf(p);
  if (!row) return null;
  const ids = checkedIds(p.state.checked);
  const on = ids.includes(row.id);
  const tick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(ids);
    const order = shownOf(p.app).map((r) => r.id);
    const anchor = Number(p.state.anchor);
    if (e.shiftKey && order.includes(anchor)) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(row.id)].sort((x, y) => x - y);
      for (const id of order.slice(a, b + 1)) next.add(id);
    } else if (on) next.delete(row.id);
    else next.add(row.id);
    p.setState("checked", [...next].join(","));
    p.setState("anchor", String(row.id));
  };
  return <input type="checkbox" checked={on} onChange={() => undefined} onClick={tick} aria-label={t("Select {name}", { name: row.title })} className="size-4 shrink-0 accent-indigo-600" />;
}

/** What a button acts on: its row — or, outside a row, the documents ticked. */
const targets = (env: ActionEnv): Row[] => {
  const ids = env.rowId ? [env.rowId] : checkedIds(env.state.checked);
  return env.props.rows.filter((r) => ids.includes(r.id) && docIdOf(r) > 0);
};

/** Read / unread: shown at once (the row's box — the database passes it on to the documents), read again after. */
function mark(env: ActionEnv, rows: Row[], unread: boolean) {
  const todo = rows.filter((r) => (r.cells.docunread === true) !== unread);
  if (!todo.length || !env.props.ctx) return;
  for (const r of todo) env.props.ctx.set(r.id, "docunread", unread);
  setTimeout(env.props.reload, 1200);
}

// (The buttons' texts in the language shown: the hook's own t, handed on with the data.)
const tOf = (env: ActionEnv): T => (env.app.t as T | undefined) ?? ((s) => s);

const view: ViewAppModule = {
  parts: {
    "documents.sync": SyncPart,
    "documents.add": AddPart,
    "documents.thumb": ThumbPart,
    "documents.pdf": PdfPart,
    "documents.file": FilePart,
    "documents.check": CheckPart,
  },
  useAppData: useDocumentsData,
  actions: {
    "documents.read": (env) => mark(env, targets(env), false),
    "documents.unread": (env) => mark(env, targets(env), true),
    "documents.readAll": (env) => mark(env, shownOf(env.app), false),
    "documents.delete": (env) => void remove(env),
    "documents.find": (env) => {
      env.setState("q", env.attrs.value ?? "");
      env.setState("scope", "all");
    },
  },
};
export default view;

/** Deleted for good (asked first): the ones ticked unticked, the preview closed if it showed one. */
async function remove(env: ActionEnv) {
  const t = tOf(env);
  const list = targets(env);
  if (!list.length) return;
  if (!confirmAction(list.length === 1 ? t("Delete “{name}” for good?", { name: list[0].title }) : t("Delete {n} documents for good?", { n: list.length }))) return;
  env.setState("busy", "true");
  for (const r of list) await deleteDocumentAction(docIdOf(r));
  env.setState("busy", "");
  env.setState("checked", "");
  if (list.some((r) => String(r.id) === env.state.selected)) env.setState("selected", "");
  toast(t("Deleted."), { tone: "ok" });
  setTimeout(env.props.reload, 800);
}
