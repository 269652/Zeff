"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { Row } from "@/plugins/workspace/model";
import { setCellAction } from "@/plugins/workspace/actions";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { uploadDocuments } from "../DocumentsApp";
import { deleteDocumentAction } from "../server-actions";

/**
 * The documents app: the Workspace's documents database as a drive - an inbox of what you have not seen, all documents, by type,
 * from mail attachments - in a grid of cards or a list, with a preview pane (the picture, the PDF, the abstract and concepts,
 * where it came from), several at once to mark read or delete, and files dropped in right here. Opening a document (its file)
 * is reading it; the unread box is the one the database keeps (ticked off here, it is ticked off there).
 */

type Doc = { row: Row; id: number; name: string; kind: string; status: string; added: string; kb: number; unread: boolean; compiled: boolean; from: string; concepts: string[]; lines: string[] };
type Scope = "inbox" | "all" | "week" | "mail" | "processing" | `kind:${string}`;
type Sort = "newest" | "oldest" | "name" | "size" | "unread";

const KINDS: Record<string, { label: string; icon: string; tint: string }> = {
  pdf: { label: "PDF", icon: "📕", tint: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  office: { label: "Office", icon: "📘", tint: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  text: { label: "Text", icon: "📄", tint: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  image: { label: "Images", icon: "🖼️", tint: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  audio: { label: "Audio", icon: "🎧", tint: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
  other: { label: "Other", icon: "📎", tint: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
};
const kindOf = (k: string) => KINDS[k] ?? KINDS.other;
const ext = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? "").toUpperCase();
const sizeText = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);
const day = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "2-digit", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};
const idOf = (row: Row) => Number(/^doc:(\d+)$/.exec(String(row.cells.srcref ?? ""))?.[1] ?? 0);

function Thumb({ doc, big = false }: { doc: Doc; big?: boolean }) {
  const k = kindOf(doc.kind);
  const [broken, setBroken] = useState(false);
  if (doc.kind === "image" && !broken)
    // eslint-disable-next-line @next/next/no-img-element -- a stored file of the documents folder
    return <img src={`/api/documents/${doc.id}/file`} alt="" loading="lazy" className={`size-full ${big ? "object-contain" : "object-cover"}`} onError={() => setBroken(true)} />;
  return (
    <div className={`flex size-full flex-col items-center justify-center gap-1 ${k.tint}`}>
      <span className={big ? "text-6xl" : "text-4xl"} aria-hidden>
        {k.icon}
      </span>
      <span className="text-[11px] font-semibold tracking-wide">{ext(doc.name) || k.label}</span>
    </div>
  );
}

function StateBadge({ doc }: { doc: Doc }) {
  const t = useT();
  if (doc.status === "failed") return <span className="rounded bg-red-100 px-1.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">{t("failed")}</span>;
  if (doc.status === "queued" || doc.status === "extracting") return <span className="rounded bg-sky-100 px-1.5 text-[11px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">{t("reading …")}</span>;
  if (doc.status === "unsupported") return <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("not readable")}</span>;
  return doc.compiled ? <span className="text-[11px] whitespace-nowrap text-emerald-600 dark:text-emerald-400" title={t("Compiled by the knowledge server")}>✓ {t("compiled")}</span> : null;
}

export default function DocumentsView(props: AppViewProps) {
  const { rows, data, openRow, reload } = props;
  const t = useT();
  // The navigation is in the Workspace tree (the view's setting): the entry asked for is in the address (?nav=); else it is this view's own.
  const inTree = props.view.nav === "workspace";
  const asked = useSearchParams().get("nav");
  const [own, setOwn] = useState<Scope>("inbox");
  const router = useRouter();
  const path = usePathname();
  const setScope = (s: Scope) => (inTree ? router.replace(`${path}?nav=${encodeURIComponent(s)}`, { scroll: false }) : setOwn(s));
  const scope: Scope = inTree ? ((asked as Scope | null) ?? "inbox") : own;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Record<number, boolean>>({});
  const last = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the layout is remembered in the browser
      setLayout(localStorage.getItem("zeff.docs.layout") === "list" ? "list" : "grid");
    } catch {
      // nothing remembered
    }
  }, []);
  const pickLayout = (l: "grid" | "list") => {
    setLayout(l);
    try {
      localStorage.setItem("zeff.docs.layout", l);
    } catch {
      // not remembered
    }
  };

  const docs: Doc[] = useMemo(
    () =>
      rows
        .map((row): Doc | null => {
          const id = idOf(row);
          if (!id) return null;
          return {
            row,
            id,
            name: row.title,
            kind: String(row.cells.dockind ?? "other"),
            status: String(row.cells.docstatus ?? ""),
            added: String(row.cells.docadded ?? ""),
            kb: Number(row.cells.docsize ?? 0),
            // (A box ticked here shows at once; the database follows a moment later.)
            unread: local[row.id] ?? row.cells.docunread === true,
            compiled: row.cells.doccompiled === true,
            from: String(row.cells.docfrom ?? ""),
            concepts: String(row.cells.docconcepts ?? "").split(",").map((x) => x.trim()).filter(Boolean),
            lines: (data.extras?.previews?.[row.id] ?? []).flatMap((l) => (l.kind === "text" ? [l.text] : [])),
          };
        })
        .filter((d): d is Doc => !!d),
    [rows, data.extras, local],
  );

  // eslint-disable-next-line react-hooks/purity -- "this week" is the week of when it is drawn
  const week = Date.now() - 7 * 864e5;
  const inScope = useCallback(
    (d: Doc, s: Scope) => (s === "inbox" ? d.unread : s === "all" ? true : s === "week" ? Date.parse(d.added) >= week : s === "mail" ? !!d.from : s === "processing" ? d.status !== "ready" : d.kind === s.slice(5)),
    [week],
  );
  const counts = useMemo(() => {
    const c = (s: Scope) => docs.filter((d) => inScope(d, s)).length;
    return { inbox: c("inbox"), all: c("all"), week: c("week"), mail: c("mail"), processing: c("processing"), kinds: Object.keys(KINDS).map((k) => [k, c(`kind:${k}`)] as const).filter(([, n]) => n > 0) };
  }, [docs, inScope]);

  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    const list = docs.filter((d) => inScope(d, scope) && (!w || `${d.name} ${d.from} ${d.concepts.join(" ")} ${d.lines.join(" ")}`.toLowerCase().includes(w)));
    const cmp: Record<Sort, (a: Doc, b: Doc) => number> = {
      newest: (a, b) => b.added.localeCompare(a.added),
      oldest: (a, b) => a.added.localeCompare(b.added),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.kb - a.kb,
      unread: (a, b) => Number(b.unread) - Number(a.unread) || b.added.localeCompare(a.added),
    };
    return [...list].sort(cmp[sort]);
  }, [docs, scope, q, sort, inScope]);

  const doc = shown.find((d) => d.row.id === picked) ?? null;
  const chosen = docs.filter((d) => checked.has(d.row.id));

  /** Unread / read for several: shown at once, written through the row's box (the database passes it on), read again after. */
  const mark = async (list: Doc[], unread: boolean) => {
    const todo = list.filter((d) => d.unread !== unread);
    if (!todo.length) return;
    setLocal((cur) => ({ ...cur, ...Object.fromEntries(todo.map((d) => [d.row.id, unread])) }));
    await Promise.all(todo.map((d) => setCellAction(d.row.id, "docunread", unread)));
    setTimeout(() => {
      reload();
      setLocal({});
    }, 1200);
  };

  const remove = async (list: Doc[]) => {
    if (!list.length) return;
    if (!confirmAction(list.length === 1 ? t("Delete “{name}” for good?", { name: list[0].name }) : t("Delete {n} documents for good?", { n: list.length }))) return;
    setBusy(true);
    for (const d of list) await deleteDocumentAction(d.id);
    setBusy(false);
    setChecked(new Set());
    if (doc && list.some((d) => d.id === doc.id)) setPicked(null);
    toast(t("Deleted."), { tone: "ok" });
    setTimeout(reload, 800);
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const r = await uploadDocuments(files);
    setBusy(false);
    if (!r.ok) return toast(r.error ?? t("That didn't work."), { tone: "error" });
    const n = r.documents?.filter((d) => d.fresh).length ?? 0;
    toast(n ? t("{n} added — being read.", { n }) : t("Already there."), { tone: "ok" });
    setScope("inbox");
    // The database takes new documents in at once; reading them takes a while - look again a few times.
    [1500, 5000, 12000].forEach((ms) => setTimeout(reload, ms));
  };

  const toggle = (d: Doc, e?: React.MouseEvent) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (e?.shiftKey && last.current !== null) {
        const a = shown.findIndex((x) => x.row.id === last.current);
        const b = shown.findIndex((x) => x.row.id === d.row.id);
        for (const x of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.row.id);
      } else if (next.has(d.row.id)) next.delete(d.row.id);
      else next.add(d.row.id);
      return next;
    });
    last.current = d.row.id;
  };

  // Arrow keys move through the documents, Escape closes the preview.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const i = shown.findIndex((d) => d.row.id === picked);
      if (e.key === "Escape") setPicked(null);
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") (e.preventDefault(), setPicked(shown[Math.min(shown.length - 1, i + 1)]?.row.id ?? null));
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") (e.preventDefault(), setPicked(shown[Math.max(0, i - 1)]?.row.id ?? null));
    };
    el.addEventListener("keydown", key);
    return () => el.removeEventListener("keydown", key);
  }, [shown, picked]);

  const scopes: { id: Scope; label: string; icon: string; n: number }[] = [
    { id: "inbox", label: t("Inbox"), icon: "📥", n: counts.inbox },
    { id: "all", label: t("All documents"), icon: "🗂️", n: counts.all },
    { id: "week", label: t("Last 7 days"), icon: "🕑", n: counts.week },
    { id: "mail", label: t("From mail"), icon: "✉️", n: counts.mail },
    ...(counts.processing ? [{ id: "processing" as Scope, label: t("Being read"), icon: "⏳", n: counts.processing }] : []),
  ];
  const emptyText = scope === "inbox" ? t("Nothing new — everything is read.") : q ? t("Nothing matches.") : t("No documents here yet.");

  return (
    <div
      ref={root}
      tabIndex={-1}
      className={`grid min-h-[34rem] grid-cols-1 overflow-hidden rounded-xl border bg-white outline-none dark:bg-zinc-950 ${over ? "border-indigo-400 ring-2 ring-indigo-300/50" : "border-zinc-200 dark:border-zinc-800"} ${inTree ? (doc ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "") : doc ? "lg:grid-cols-[12.5rem_minmax(0,1fr)_22rem]" : "lg:grid-cols-[12.5rem_minmax(0,1fr)]"}`}
      data-app-view="documents"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        void upload(files);
      }}
    >
      {/* Scopes */}
      {!inTree && (
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-100 p-2 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 dark:border-zinc-800" aria-label={t("Documents")}>
        <label className="btn btn-primary btn-sm mb-1 shrink-0 cursor-pointer justify-center lg:mb-2">
          + {t("Add files")}
          <input type="file" multiple hidden onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ""))} />
        </label>
        {scopes.map((s) => (
          <button key={s.id} type="button" aria-current={scope === s.id ? "page" : undefined} onClick={() => (setScope(s.id), setChecked(new Set()))} className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${scope === s.id ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}>
            <span aria-hidden>{s.icon}</span>
            <span className="flex-1 whitespace-nowrap">{s.label}</span>
            {s.n > 0 && <span className={`text-xs tabular-nums ${s.id === "inbox" ? "rounded-full bg-indigo-600 px-1.5 text-white" : "text-zinc-400"}`}>{s.n}</span>}
          </button>
        ))}
        {counts.kinds.length > 0 && <p className="mt-2 hidden px-2.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase lg:block">{t("Type")}</p>}
        {counts.kinds.map(([k, n]) => (
          <button key={k} type="button" aria-current={scope === `kind:${k}` ? "page" : undefined} onClick={() => (setScope(`kind:${k}`), setChecked(new Set()))} className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${scope === `kind:${k}` ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}>
            <span aria-hidden>{KINDS[k].icon}</span>
            <span className="flex-1 whitespace-nowrap">{t(KINDS[k].label)}</span>
            <span className="text-xs text-zinc-400 tabular-nums">{n}</span>
          </button>
        ))}
      </nav>
      )}

      {/* The documents */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {inTree && (
            <label className="btn btn-primary btn-sm cursor-pointer">
              + {t("Add files")}
              <input type="file" multiple hidden onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ""))} />
            </label>
          )}
          {chosen.length > 0 ? (
            <>
              <span className="text-sm font-medium">{t("{n} selected", { n: chosen.length })}</span>
              <button type="button" className="btn btn-sm" onClick={() => void mark(chosen, false)}>
                ✓ {t("Mark read")}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void mark(chosen, true)}>
                ● {t("Mark unread")}
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove(chosen)}>
                🗑 {t("Delete")}
              </button>
              <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={() => setChecked(new Set())}>
                {t("Clear")}
              </button>
            </>
          ) : (
            <>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search documents …")} aria-label={t("Search documents")} className="input max-w-72 min-w-40 flex-1 text-sm" />
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Sort")} className="input w-auto text-sm">
                <option value="newest">{t("Newest first")}</option>
                <option value="oldest">{t("Oldest first")}</option>
                <option value="unread">{t("Unread first")}</option>
                <option value="name">{t("Name")}</option>
                <option value="size">{t("Largest first")}</option>
              </select>
              <span className="flex-1" />
              {scope === "inbox" && counts.inbox > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => void mark(shown, false)}>
                  ✓ {t("Mark all read")}
                </button>
              )}
              <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700" role="group" aria-label={t("Layout")}>
                {(["grid", "list"] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={layout === l} title={l === "grid" ? t("Grid") : t("List")} onClick={() => pickLayout(l)} className={`rounded px-2 py-0.5 text-sm ${layout === l ? "bg-zinc-200 dark:bg-zinc-700" : "text-zinc-500"}`}>
                    {l === "grid" ? "▦" : "☰"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {busy && <p className="px-3 pt-2 text-xs text-sky-600">{t("Working …")}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!shown.length ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500">
              <span className="text-4xl" aria-hidden>
                {scope === "inbox" ? "🎉" : "🗂️"}
              </span>
              <p>{emptyText}</p>
              <p className="text-xs text-zinc-400">{t("Drop files here to add them.")}</p>
            </div>
          ) : layout === "grid" ? (
            <ul className={`grid gap-3 ${doc ? "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]"}`}>
              {shown.map((d) => (
                <li key={d.row.id} className="group/card relative">
                  <button type="button" onClick={() => setPicked(d.row.id)} onDoubleClick={() => openRow(d.row.id)} aria-pressed={picked === d.row.id} className={`flex w-full flex-col overflow-hidden rounded-xl border text-left transition hover:shadow-md ${picked === d.row.id ? "border-indigo-500 ring-2 ring-indigo-400/40" : "border-zinc-200 dark:border-zinc-800"} ${checked.has(d.row.id) ? "bg-indigo-50/60 dark:bg-indigo-950/30" : "bg-white dark:bg-zinc-900"}`}>
                    <div className="aspect-[4/3] w-full overflow-hidden border-b border-zinc-100 dark:border-zinc-800">
                      <Thumb doc={d} />
                    </div>
                    <div className="space-y-0.5 p-2.5">
                      <p className={`line-clamp-2 text-sm leading-snug break-words ${d.unread ? "font-semibold" : ""}`}>{d.name}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {sizeText(d.kb)} · {day(d.added)}
                      </p>
                      {d.from && (
                        <p className="truncate text-[11px] text-zinc-400" title={d.from}>
                          ✉ {d.from}
                        </p>
                      )}
                      <div className="flex min-h-4 items-center">
                        <StateBadge doc={d} />
                      </div>
                    </div>
                  </button>
                  {d.unread && <span className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-indigo-600 ring-2 ring-white dark:ring-zinc-900" title={t("Unread")} />}
                  <input type="checkbox" checked={checked.has(d.row.id)} onChange={() => undefined} onClick={(e) => toggle(d, e)} aria-label={t("Select {name}", { name: d.name })} className={`absolute top-2 left-2 size-4 accent-indigo-600 ${checked.has(d.row.id) || chosen.length ? "" : "opacity-0 group-hover/card:opacity-100 focus:opacity-100"}`} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {shown.map((d) => (
                <li key={d.row.id} className={`group/row flex items-center gap-2 px-2.5 py-1.5 text-sm ${picked === d.row.id ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}>
                  <input type="checkbox" checked={checked.has(d.row.id)} onChange={() => undefined} onClick={(e) => toggle(d, e)} aria-label={t("Select {name}", { name: d.name })} className="size-4 shrink-0 accent-indigo-600" />
                  <span className={`size-2 shrink-0 rounded-full ${d.unread ? "bg-indigo-600" : "bg-transparent"}`} aria-hidden />
                  <span className="shrink-0 text-lg" aria-hidden>
                    {kindOf(d.kind).icon}
                  </span>
                  <button type="button" className={`min-w-0 flex-1 truncate text-left ${d.unread ? "font-semibold" : ""}`} onClick={() => setPicked(d.row.id)} onDoubleClick={() => openRow(d.row.id)} title={d.name}>
                    {d.name}
                  </button>
                  <span className="hidden max-w-48 truncate text-xs text-zinc-400 md:block" title={d.from}>
                    {d.from}
                  </span>
                  <StateBadge doc={d} />
                  <span className="hidden w-16 shrink-0 text-right text-xs text-zinc-500 tabular-nums sm:block">{sizeText(d.kb)}</span>
                  <span className="w-20 shrink-0 text-right text-xs text-zinc-500">{day(d.added)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* The preview */}
      {doc && (
        <aside className="flex min-h-0 flex-col border-t border-zinc-100 lg:border-t-0 lg:border-l dark:border-zinc-800" aria-label={t("Preview")}>
          <div className="flex items-start gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
            <p className="min-w-0 flex-1 text-sm font-semibold break-words">{doc.name}</p>
            <button type="button" className="icon-btn" onClick={() => setPicked(null)} aria-label={t("Close")}>
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              {doc.kind === "pdf" ? <iframe src={`/api/documents/${doc.id}/file#toolbar=0`} title={doc.name} className="size-full bg-white" /> : <Thumb doc={doc} big />}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/documents/${doc.id}/file?open=1`} target="_blank" rel="noreferrer" onClick={() => setLocal((cur) => ({ ...cur, [doc.row.id]: false }))} className="btn btn-primary btn-sm">
                {t("Open")}
              </a>
              <a href={`/api/documents/${doc.id}/file?open=1`} download={doc.name} className="btn btn-sm">
                ⇩ {t("Download")}
              </a>
              <button type="button" className="btn btn-sm" onClick={() => void mark([doc], !doc.unread)}>
                {doc.unread ? `✓ ${t("Mark read")}` : `● ${t("Mark unread")}`}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => openRow(doc.row.id)}>
                {t("Page")}
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove([doc])}>
                🗑
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-zinc-400">{t("Type")}</dt>
              <dd>{t(kindOf(doc.kind).label)}</dd>
              <dt className="text-zinc-400">{t("Size")}</dt>
              <dd>{sizeText(doc.kb)}</dd>
              <dt className="text-zinc-400">{t("Added")}</dt>
              <dd>{doc.added ? new Date(doc.added).toLocaleString() : ""}</dd>
              {doc.from && (
                <>
                  <dt className="text-zinc-400">{t("From")}</dt>
                  <dd className="break-words">{doc.from}</dd>
                </>
              )}
              <dt className="text-zinc-400">{t("State")}</dt>
              <dd>{doc.status === "ready" ? (doc.compiled ? t("Read and compiled") : t("Read")) : t(doc.status)}</dd>
            </dl>
            {doc.lines.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{t("Abstract")}</p>
                <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{doc.lines.slice(0, 4).join(" ").replace(/^#+\s*/, "").slice(0, 600)}</p>
              </div>
            )}
            {doc.concepts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {doc.concepts.slice(0, 12).map((c) => (
                  <button key={c} type="button" className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700" onClick={() => (setQ(c), setScope("all"))} title={t("Search for this")}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
