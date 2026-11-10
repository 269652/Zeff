import { Fragment, useRef, useState } from "react";
import type { RPage } from "@/lib/replica/shared";
import { docToMarkdown, markdownEditable, markdownToDoc } from "@/plugins/workspace/doc";
import { kindIcon, normalizeSchema, type DbSchema, type Option, type Property } from "@/plugins/workspace/model/schema";
import { cellText } from "@/plugins/workspace/model/values";
import { parseMarkdown, type MdBlock, type MdInline } from "@/lib/markdown";
import { useReplica } from "./main";
import { fmtDay, tr } from "./words";

const pageKey = (id: number | string) => `page:${id}`;
const byPosition = (a: RPage, b: RPage) => a.position - b.position || String(a.title).localeCompare(String(b.title));
const titleOf = (p: RPage) => p.title || tr("Untitled");
const iconOf = (p: RPage) => p.icon || kindIcon(p.kind);

/** What waits to be sent, by the page or row it's about. */
const usePendingPages = () => {
  const { engine } = useReplica();
  return new Set(engine.pending().map((o) => String((o as { page?: unknown; row?: unknown; tmp?: unknown }).page ?? (o as { row?: unknown }).row ?? (o as { tmp?: unknown }).tmp ?? "")));
};

/** The quiet "will be sent" chip (as in the todos). */
const PendingChip = () => <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 text-xs leading-5 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{tr("pending")}</span>;

// Zeff's tag colours (workspace.css .ws-tag[data-color]) — spelled out, so Tailwind finds them.
const TAG: Record<string, string> = {
  gray: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  brown: "bg-amber-900/15 text-amber-900 dark:bg-amber-700/25 dark:text-amber-200",
  orange: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
  yellow: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-300",
  green: "bg-green-600/15 text-green-800 dark:text-green-300",
  blue: "bg-blue-500/15 text-blue-800 dark:text-blue-300",
  purple: "bg-purple-500/15 text-purple-800 dark:text-purple-300",
  pink: "bg-pink-500/15 text-pink-800 dark:text-pink-300",
  red: "bg-red-500/15 text-red-800 dark:text-red-300",
};
const DOT: Record<string, string> = {
  gray: "bg-zinc-400",
  brown: "bg-amber-800",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-600",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  red: "bg-red-500",
};
function Tag({ option }: { option: Pick<Option, "name" | "color"> }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded px-1.5 text-xs leading-5 ${TAG[option.color] ?? TAG.gray}`}>{option.name}</span>;
}

/** A cell as Zeff shows it: choices as coloured tags, a checkbox ticked, the rest as text. */
function CellValue({ p, v }: { p: Property; v: unknown }) {
  if ((p.type === "select" || p.type === "status") && typeof v === "string") {
    const o = p.options?.find((x) => x.id === v);
    if (o) return <Tag option={o} />;
  }
  if (p.type === "multi_select" && Array.isArray(v)) {
    const os = (p.options ?? []).filter((o) => (v as string[]).includes(o.id));
    if (os.length)
      return (
        <span className="flex flex-wrap gap-1">
          {os.map((o) => (
            <Tag key={o.id} option={o} />
          ))}
        </span>
      );
  }
  if (p.type === "checkbox") return <span className={v ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}>{v ? "☑" : "☐"}</span>;
  if (p.type === "date") {
    const day = typeof v === "string" ? v : v && typeof v === "object" && "start" in v ? String((v as { start: unknown }).start) : "";
    if (/^\d{4}-\d{2}-\d{2}/.test(day)) return <>{fmtDay(day)}</>;
  }
  return <>{cellText(p, v)}</>;
}
/** Worth showing in a list: a value there (a checkbox only ticked). */
const hasValue = (p: Property, v: unknown) => (p.type === "checkbox" ? !!v : v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length) && !!cellText(p, v));

/** Zeff's .icon-btn spelled out (the companion's own app.css has an .icon-btn of its own, framed). */
const ICON = "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:disabled:text-zinc-700";

/** A small icon button (Zeff's .icon-btn, a thumb's size). */
function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={`${ICON} size-9 text-base`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
);

/** The Workspace from the phone's copy: the tree, a page (its text, its subpages), a database (table or board), a row. */
export function WorkspaceView() {
  const [open, setOpen] = useState<string | null>(() => sessionStorage.getItem("zeff.offline.page"));
  const go = (id: string | null) => {
    setOpen(id);
    if (id) sessionStorage.setItem("zeff.offline.page", id);
    else sessionStorage.removeItem("zeff.offline.page");
    window.scrollTo(0, 0);
  };
  const { engine } = useReplica();
  const page = open ? engine.get<"page">(pageKey(open)) : undefined;
  return page ? <PageView key={String(page.id)} page={page} go={go} /> : <Tree go={go} />;
}

/** Zeff's page tree (src/plugins/workspace/ui/Sidebar.tsx): icon and title, folded subpages; favourites above. */
function Tree({ go }: { go: (id: string | null) => void }) {
  const { engine, edit } = useReplica();
  const waiting = usePendingPages();
  const pages = engine.list("page").filter((p) => p.dbId === null);
  const kids = (id: number | null) => pages.filter((p) => p.parentId === id).sort(byPosition);
  const favorites = pages.filter((p) => p.favorite).sort(byPosition);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem("zeff.offline.tree") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        sessionStorage.setItem("zeff.offline.tree", JSON.stringify([...n]));
      } catch {
        /* (only a convenience) */
      }
      return n;
    });
  const row = (p: RPage, depth: number, children: RPage[] | null) => {
    const id = String(p.id);
    const isOpen = expanded.has(id);
    return (
      <li data-zo="page" className="flex min-h-11 items-center gap-1 pr-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60" style={{ paddingLeft: `${0.25 + depth * 1.1}rem` }}>
        {children === null ? null : children.length ? (
          <button type="button" className={`${ICON} size-9`} aria-expanded={isOpen} aria-label={titleOf(p)} onClick={() => toggle(id)}>
            <Chevron open={isOpen} />
          </button>
        ) : (
          <span className="size-9 shrink-0" aria-hidden />
        )}
        <button type="button" className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2.5 text-left text-sm ${children === null ? "pl-2" : ""}`} onClick={() => go(id)}>
          <span className="shrink-0 text-base leading-none">{iconOf(p)}</span>
          <span className={`truncate ${p.title ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>{titleOf(p)}</span>
          {p.locked && (
            <span className="shrink-0 text-xs" aria-label={tr("locked")}>
              🔒
            </span>
          )}
          {waiting.has(id) && <PendingChip />}
          {children !== null && children.length > 0 && !isOpen && <span className="ml-auto shrink-0 pl-1 text-xs text-zinc-400 tabular-nums">{children.length}</span>}
        </button>
      </li>
    );
  };
  const node = (p: RPage, depth: number): React.ReactNode => {
    const children = kids(p.id);
    return (
      <Fragment key={p.id}>
        {row(p, depth, children)}
        {expanded.has(String(p.id)) && children.map((c) => node(c, depth + 1))}
      </Fragment>
    );
  };
  const roots = kids(null);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-semibold">{tr("Workspace")}</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            const tmp = await edit({ kind: "page.add", parent: null, title: "" });
            if (tmp) go(tmp);
          }}
        >
          + {tr("New page")}
        </button>
      </div>
      {favorites.length > 0 && (
        <section>
          <h2 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="text-amber-500" aria-hidden>
              ★
            </span>
            {tr("Favorites")} <span className="text-zinc-400">{favorites.length}</span>
          </h2>
          <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
            {favorites.map((p) => (
              <Fragment key={p.id}>{row(p, 0, null)}</Fragment>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <span className="size-1.5 rounded-full bg-indigo-500" aria-hidden />
          {tr("Pages")} <span className="text-zinc-400">{roots.length}</span>
        </h2>
        {roots.length ? <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">{roots.map((p) => node(p, 0))}</ul> : <p className="px-1 text-sm text-zinc-500">{tr("noPages")}</p>}
      </section>
    </div>
  );
}

const ICONS = ["📄", "📝", "📌", "⭐", "✅", "📅", "💡", "🏠", "💼", "📚", "🎯", "🛒", "💰", "❤️", "🎉", "🔧", "📦", "🚗", "✈️", "🍽️", "🎵", "🌱", "🐾", "📷"];

/** Zeff's icon picker, for a thumb: common ones, any other typed, or none. */
function IconPicker({ icon, set, close }: { icon: string; set: (v: string) => void; close: () => void }) {
  const [other, setOther] = useState("");
  return (
    <div className="card space-y-3 p-3" role="dialog" aria-label={tr("Change the icon")}>
      <div className="grid grid-cols-8 gap-1">
        {ICONS.map((e) => (
          <button key={e} type="button" className={`flex aspect-square items-center justify-center rounded-lg text-2xl hover:bg-zinc-100 dark:hover:bg-zinc-800 ${icon === e ? "bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-950/50" : ""}`} aria-label={e} onClick={() => (set(e), close())}>
            {e}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!other.trim()) return;
          set(other.trim().slice(0, 64));
          close();
        }}
      >
        <input className="input min-w-0 flex-1" value={other} maxLength={64} onChange={(e) => setOther(e.target.value)} placeholder={tr("Other icon …")} aria-label={tr("Other icon …")} />
        <button type="submit" className="btn" disabled={!other.trim()}>
          {tr("Save")}
        </button>
      </form>
      <div className="flex justify-between gap-2">
        {icon ? (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => (set(""), close())}>
            {tr("Remove icon")}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-sm" onClick={close}>
          {tr("Cancel")}
        </button>
      </div>
    </div>
  );
}

function PageView({ page, go }: { page: RPage; go: (id: string | null) => void }) {
  const { engine, edit } = useReplica();
  const waiting = usePendingPages();
  // Your title while you type (null: the page's own).
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const title = draft ?? page.title;
  const parent = page.dbId ?? page.parentId;
  const parentPage = parent !== null ? engine.get<"page">(pageKey(parent)) : undefined;
  const sub = engine
    .list("page")
    .filter((p) => p.parentId === page.id && p.dbId === null)
    .sort(byPosition);
  const db = page.dbId ? engine.get<"page">(pageKey(page.dbId)) : undefined;
  const schema = db?.schema ? normalizeSchema(db.schema) : null;
  const back = () => go(parent === null ? null : String(parent));
  const saveTitle = () => {
    if (draft !== null && draft !== page.title) void edit({ kind: "page.set", page: page.id, field: "title", value: draft.slice(0, 500) });
    setDraft(null);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" className="flex min-h-9 min-w-0 items-center gap-1 truncate text-sm text-zinc-500 hover:underline" onClick={back}>
          ← {parentPage ? `${iconOf(parentPage)} ${titleOf(parentPage)}` : tr("Workspace")}
        </button>
        {waiting.has(String(page.id)) && (
          <span className="ml-auto">
            <PendingChip />
          </span>
        )}
      </div>
      {page.locked && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">🔒 {tr("locked")}</p>}
      {/* The page's head as in Zeff (PageView.tsx): the icon (tap: change it), the title big. */}
      <div className="flex items-start gap-2">
        {page.locked ? (
          page.icon && <span className="pt-1 text-3xl leading-none">{page.icon}</span>
        ) : (
          <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-3xl leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={tr("Change the icon")} aria-expanded={picking} title={tr("Change the icon")} onClick={() => setPicking((x) => !x)}>
            {page.icon || (
              <span className="text-2xl text-zinc-300 dark:text-zinc-600" aria-hidden>
                ☺
              </span>
            )}
          </button>
        )}
        <textarea
          rows={1}
          className="min-w-0 flex-1 resize-none bg-transparent py-1 break-words text-3xl leading-tight font-bold outline-none [field-sizing:content] placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
          value={title}
          placeholder={tr("Untitled")}
          aria-label={tr("Title")}
          readOnly={page.locked}
          autoFocus={!page.title && !page.locked}
          onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={saveTitle}
        />
      </div>
      {picking && !page.locked && <IconPicker icon={page.icon} set={(v) => void edit({ kind: "page.set", page: page.id, field: "icon", value: v })} close={() => setPicking(false)} />}
      {schema && <RowFields row={page} schema={schema} />}
      {page.kind === "database" ? <DatabaseView db={page} go={go} /> : <Body page={page} />}
      {page.kind !== "database" && !page.dbId && (
        <section>
          <h2 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="size-1.5 rounded-full bg-zinc-400" aria-hidden />
            {tr("Subpages")} <span className="text-zinc-400">{sub.length}</span>
          </h2>
          <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
            {sub.map((p) => (
              <li key={p.id} data-zo="page">
                <button type="button" className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60" onClick={() => go(String(p.id))}>
                  <span className="shrink-0 text-base leading-none">{iconOf(p)}</span>
                  <span className={`min-w-0 flex-1 truncate ${p.title ? "font-medium" : "text-zinc-500"}`}>{titleOf(p)}</span>
                  {waiting.has(String(p.id)) && <PendingChip />}
                  <span className="text-zinc-400" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-800 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-200"
                onClick={async () => {
                  const tmp = await edit({ kind: "page.add", parent: page.id, title: "" });
                  if (tmp) go(tmp);
                }}
              >
                + {tr("New subpage")}
              </button>
            </li>
          </ul>
        </section>
      )}
      {!page.locked && (
        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (!confirm(`${tr("To the trash")}: ${titleOf(page)}?`)) return;
              void edit({ kind: "page.archive", page: page.id });
              back();
            }}
          >
            🗑 {tr("To the trash")}
          </button>
        </div>
      )}
    </div>
  );
}

/** A page's text: shown, and as Markdown to edit (it goes back as the page's document). */
function Body({ page }: { page: RPage }) {
  const { edit } = useReplica();
  const md = docToMarkdown(page.content as never);
  // Blocks Markdown doesn't keep (a callout, an embedded database …) would be lost: such a page is edited on the PC.
  const editable = !page.locked && markdownEditable(page.content);
  // The text while you edit it (null: not editing — the page's own is shown).
  const [text, setText] = useState<string | null>(null);
  const editing = text !== null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (v: string) => {
    if (v === md) return;
    void edit({ kind: "page.set", page: page.id, field: "content", value: markdownToDoc(v) });
  };
  if (editing && editable)
    return (
      <div className="space-y-2">
        <textarea
          className="input min-h-[50vh] font-mono text-sm leading-relaxed"
          value={text}
          autoFocus
          aria-label={tr("Edit")}
          rows={Math.max(10, text.split("\n").length + 2)}
          onChange={(e) => {
            setText(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            const v = e.target.value;
            timer.current = setTimeout(() => save(v), 2000);
          }}
        />
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-xs text-zinc-500">{tr("markdownHint")}</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              save(text);
              setText(null);
            }}
          >
            {tr("Done2")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="space-y-2">
      {md.trim() ? (
        <div className="relative">
          <Markdown text={md} />
          {editable && (
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn btn-sm" onClick={() => setText(md)}>
                ✎ {tr("Edit")}
              </button>
            </div>
          )}
        </div>
      ) : editable ? (
        <button type="button" className="flex min-h-24 w-full cursor-text items-start rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-left text-sm text-zinc-500 hover:border-indigo-300 hover:text-zinc-700 dark:border-zinc-700 dark:hover:border-indigo-700 dark:hover:text-zinc-300" onClick={() => setText("")}>
          ✎ {tr("emptyBody")}
        </button>
      ) : null}
      {!editable && !page.locked && <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{tr("pcOnlyBody")}</p>}
    </div>
  );
}

type Add = (cells?: Record<string, unknown>) => void;
type Place = (row: RPage, list: RPage[], dir: -1 | 1) => void;

/** A database as Zeff shows it on a phone: the table's rows as cards, a board's columns side by side (scrolled sideways). */
function DatabaseView({ db, go }: { db: RPage; go: (id: string | null) => void }) {
  const { engine, edit } = useReplica();
  const schema = normalizeSchema(db.schema);
  // A board by its board view's grouping — else by its first status (or select) field, so a list of tasks is a board here too.
  const groupBy = schema.views.find((v) => v.type === "board" && v.groupBy)?.groupBy ?? (schema.properties.find((p) => p.type === "status") ?? schema.properties.find((p) => p.type === "select"))?.id;
  const [mode, setMode] = useState<"table" | "board">(schema.views.some((v) => v.type === "board") ? "board" : "table");
  const [arrange, setArrange] = useState(false);
  const rows = engine
    .list("page")
    .filter((p) => p.dbId === db.id)
    .sort(byPosition);
  const add = async (cells: Record<string, unknown> = {}) => {
    const tmp = await edit({ kind: "row.add", db: db.id, title: "", cells });
    if (tmp) go(tmp);
  };
  // One step up or down in the list shown (a column, the table): between its neighbours there.
  const place: Place = (row, list, dir) => {
    const i = list.findIndex((r) => r.id === row.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const [after, before] = dir < 0 ? [list[j - 1]?.id ?? null, list[j].id] : [list[j].id, list[j + 1]?.id ?? null];
    void edit({ kind: "row.place", row: row.id, after, before });
  };
  const board = mode === "board" && groupBy;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {groupBy && (
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900" role="tablist">
            {(["board", "table"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`min-h-8 rounded-md px-3 text-sm ${mode === m ? "bg-white font-medium text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}`} onClick={() => setMode(m)}>
                {tr(m === "board" ? "Board" : "Table")}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs text-zinc-500 tabular-nums">{tr("nRows", { n: rows.length })}</span>
        <span className="ml-auto flex gap-2">
          {rows.length > 1 && !db.locked && (
            <button type="button" className={`btn btn-sm ${arrange ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300" : ""}`} aria-pressed={arrange} onClick={() => setArrange((a) => !a)}>
              ⇅ {arrange ? tr("Done2") : tr("Arrange")}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void add()}>
            + {tr("New")}
          </button>
        </span>
      </div>
      {board ? <Board rows={rows} schema={schema} groupBy={groupBy} go={go} add={add} place={place} arrange={arrange} /> : <TableCards rows={rows} schema={schema} go={go} add={add} place={place} arrange={arrange} />}
    </div>
  );
}

/** The fields a row shows in a list (the view's, not hidden; the first few with a value). */
function shownFields(schema: DbSchema, type: "table" | "board", skip?: string) {
  const view = schema.views.find((v) => v.type === type) ?? schema.views[0];
  const hidden = new Set((view as { hidden?: string[] } | undefined)?.hidden ?? []);
  return schema.properties.filter((p) => !hidden.has(p.id) && p.id !== skip);
}

function TableCards({ rows, schema, go, add, place, arrange }: { rows: RPage[]; schema: DbSchema; go: (id: string | null) => void; add: Add; place: Place; arrange: boolean }) {
  const waiting = usePendingPages();
  const fields = shownFields(schema, "table");
  if (!rows.length)
    return (
      <button type="button" className="w-full rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 hover:border-indigo-300 dark:border-zinc-700" onClick={() => add()}>
        {tr("noRows")} + {tr("New")}
      </button>
    );
  return (
    <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
      {rows.map((r, i) => {
        const meta = fields.filter((p) => hasValue(p, r.props[p.id])).slice(0, 4);
        return (
          <li key={r.id} data-zo="row" className="flex items-stretch">
            <button type="button" className="min-w-0 flex-1 cursor-pointer px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60" onClick={() => go(String(r.id))}>
              <span className="flex items-center gap-2 text-sm">
                <span className="shrink-0 leading-none">{iconOf(r)}</span>
                <span className={`min-w-0 flex-1 truncate ${r.title ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>{titleOf(r)}</span>
                {waiting.has(String(r.id)) && <PendingChip />}
              </span>
              {meta.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                  {meta.map((p) => (
                    <div key={p.id} className="min-w-0">
                      <dt className="truncate text-[11px] tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{p.name}</dt>
                      <dd className="truncate text-sm text-zinc-800 dark:text-zinc-200">
                        <CellValue p={p} v={r.props[p.id]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </button>
            {arrange && (
              <span className="flex shrink-0 flex-col justify-center pr-1">
                <IconBtn label={tr("Move up")} disabled={i === 0} onClick={() => place(r, rows, -1)}>
                  ↑
                </IconBtn>
                <IconBtn label={tr("Move down")} disabled={i === rows.length - 1} onClick={() => place(r, rows, 1)}>
                  ↓
                </IconBtn>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Zeff's board (database/board-view.tsx): a column per choice, its cards; sideways on a phone. Arranging: up/down in a column, left/right to the next. */
function Board({ rows, schema, groupBy, go, add, place, arrange }: { rows: RPage[]; schema: DbSchema; groupBy: string; go: (id: string | null) => void; add: Add; place: Place; arrange: boolean }) {
  const { edit } = useReplica();
  const waiting = usePendingPages();
  const prop = schema.properties.find((p) => p.id === groupBy);
  const options = prop?.options ?? [];
  const fields = shownFields(schema, "board", groupBy);
  const inOf = (id: string | null) => rows.filter((r) => (id === null ? !options.some((o) => o.id === r.props[groupBy]) : r.props[groupBy] === id));
  const cols = [...options.map((o) => ({ id: o.id as string | null, name: o.name, color: o.color })), { id: null, name: tr("No value"), color: "gray" }].map((c) => ({ ...c, rows: inOf(c.id) })).filter((c) => c.id !== null || c.rows.length);
  // To the next column: its value set, at the column's end.
  const shift = async (r: RPage, from: number, dir: -1 | 1) => {
    const to = cols[from + dir];
    if (!to) return;
    await edit({ kind: "row.cell", row: r.id, prop: groupBy, value: to.id });
    const last = to.rows.at(-1);
    if (last) await edit({ kind: "row.place", row: r.id, after: last.id, before: null });
  };
  return (
    <div className="-mx-3 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-3 pb-3 [scrollbar-width:thin]">
      {cols.map((c, ci) => (
        <section key={String(c.id)} className="w-[17rem] shrink-0 snap-start space-y-2 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-800/55" aria-label={c.name}>
          <h3 className="flex items-center gap-2 px-1 text-sm">
            {c.id === null ? <span className="font-medium text-zinc-500">{c.name}</span> : <Tag option={c} />}
            <span className="text-zinc-400 tabular-nums">{c.rows.length}</span>
          </h3>
          {c.rows.map((r, i) => {
            const meta = fields.filter((p) => hasValue(p, r.props[p.id])).slice(0, 3);
            return (
              <div key={r.id} data-zo="row" className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
                <button type="button" className="block w-full cursor-pointer px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60" onClick={() => go(String(r.id))}>
                  <span className="flex items-start gap-1.5 text-sm leading-snug">
                    {r.icon && <span className="shrink-0">{r.icon}</span>}
                    <span className={`min-w-0 flex-1 ${r.title ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>{titleOf(r)}</span>
                  </span>
                  {(meta.length > 0 || waiting.has(String(r.id))) && (
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      {meta.map((p) => (
                        <span key={p.id} className="max-w-full truncate">
                          <CellValue p={p} v={r.props[p.id]} />
                        </span>
                      ))}
                      {waiting.has(String(r.id)) && <PendingChip />}
                    </span>
                  )}
                </button>
                {arrange && (
                  <div className="flex items-center justify-between border-t border-zinc-100 px-1 dark:border-zinc-800">
                    <IconBtn label={tr("Move left")} disabled={ci === 0} onClick={() => void shift(r, ci, -1)}>
                      ←
                    </IconBtn>
                    <IconBtn label={tr("Move up")} disabled={i === 0} onClick={() => place(r, c.rows, -1)}>
                      ↑
                    </IconBtn>
                    <IconBtn label={tr("Move down")} disabled={i === c.rows.length - 1} onClick={() => place(r, c.rows, 1)}>
                      ↓
                    </IconBtn>
                    <IconBtn label={tr("Move right")} disabled={ci === cols.length - 1} onClick={() => void shift(r, ci, 1)}>
                      →
                    </IconBtn>
                  </div>
                )}
              </div>
            );
          })}
          {c.id !== null && (
            <button type="button" className="flex min-h-10 w-full items-center rounded-md px-2 text-left text-sm text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-200" onClick={() => add({ [groupBy]: c.id })}>
              + {tr("New")}
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

const EDITABLE = new Set(["text", "markdown", "url", "email", "phone", "number", "select", "status", "multi_select", "checkbox", "date"]);

/** A row's fields as Zeff lists them (name, value): the simple kinds editable here, the rest shown as they are (changed on the PC). */
function RowFields({ row, schema }: { row: RPage; schema: DbSchema }) {
  const { edit } = useReplica();
  const set = (p: Property, value: unknown) => void edit({ kind: "row.cell", row: row.id, prop: p.id, value });
  if (!schema.properties.length) return null;
  return (
    <section>
      <h2 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        <span className="size-1.5 rounded-full bg-indigo-500" aria-hidden />
        {tr("Fields")}
      </h2>
      <div className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
        {schema.properties.map((p) => {
          const v = row.props[p.id] ?? null;
          const can = EDITABLE.has(p.type) && !row.locked;
          const id = `zo-f-${p.id}`;
          return (
            <div key={p.id} data-zo="field" className="flex min-h-11 items-center gap-3 px-3 py-2">
              <label htmlFor={id} id={`${id}-l`} className="w-28 shrink-0 truncate text-sm text-zinc-500 dark:text-zinc-400">
                {p.name}
              </label>
              <div className="min-w-0 flex-1 text-sm">
                {can ? (
                  <FieldInput id={id} p={p} v={v} set={(x) => set(p, x)} />
                ) : (
                  <output title={tr("readOnlyField")} className="block truncate text-zinc-800 dark:text-zinc-200">
                    {hasValue(p, v) ? <CellValue p={p} v={v} /> : <span className="text-zinc-400">{tr("No value")}</span>}
                  </output>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FieldInput({ id, p, v, set }: { id: string; p: Property; v: unknown; set: (v: unknown) => void }) {
  // What you type (null: the field's own value).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (v === null || v === undefined || typeof v === "object" ? "" : String(v));
  switch (p.type) {
    case "checkbox":
      return <input id={id} type="checkbox" className="size-5 cursor-pointer accent-indigo-600" checked={!!v} onChange={(e) => set(e.target.checked)} />;
    case "select":
    case "status": {
      const o = (p.options ?? []).find((x) => x.id === v);
      return (
        <span className="flex items-center gap-2">
          {o && <span className={`size-2.5 shrink-0 rounded-full ${DOT[o.color] ?? DOT.gray}`} aria-hidden />}
          <select id={id} className="input" value={typeof v === "string" ? v : ""} onChange={(e) => set(e.target.value || null)}>
            <option value="">{tr("No value")}</option>
            {(p.options ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </span>
      );
    }
    case "multi_select": {
      const have = new Set(Array.isArray(v) ? (v as string[]) : []);
      return (
        <span id={id} role="group" aria-labelledby={`${id}-l`} className="flex flex-wrap gap-1.5">
          {(p.options ?? []).map((o) => {
            const on = have.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                className={`min-h-8 rounded-md px-2 text-xs ${on ? `${TAG[o.color] ?? TAG.gray} font-medium ring-1 ring-current/30` : "border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"}`}
                onClick={() => {
                  const next = new Set(have);
                  if (on) next.delete(o.id);
                  else next.add(o.id);
                  set([...next]);
                }}
              >
                {on ? "✓ " : ""}
                {o.name}
              </button>
            );
          })}
        </span>
      );
    }
    case "date": {
      const start = typeof v === "string" ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String((v as { start: string }).start).slice(0, 10) : "";
      return <input id={id} type="date" className="input w-auto" value={start} onChange={(e) => set(e.target.value || null)} />;
    }
    case "number":
      return <input id={id} type="number" className="input" inputMode="decimal" value={text} onChange={(e) => setDraft(e.target.value)} onBlur={() => (draft !== null && set(draft.trim() === "" ? null : Number(draft)), setDraft(null))} />;
    case "markdown":
      return <textarea id={id} className="input" rows={3} value={text} onChange={(e) => setDraft(e.target.value)} onBlur={() => (draft !== null && draft !== (v ?? "") && set(draft || null), setDraft(null))} />;
    default:
      return (
        <input
          id={id}
          className="input"
          type={p.type === "url" ? "url" : p.type === "email" ? "email" : p.type === "phone" ? "tel" : "text"}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => (draft !== null && draft !== (v ?? "") && set(draft || null), setDraft(null))}
        />
      );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Markdown shown as Zeff's editor shows a page (workspace.css .ws-editor; src/lib/markdown.ts's blocks; formulas as TeX)
// ---------------------------------------------------------------------------------------------------------------------

function Markdown({ text }: { text: string }) {
  return (
    <div data-zo="body" className="space-y-2 text-[15px] leading-relaxed break-words text-zinc-800 dark:text-zinc-200">
      {parseMarkdown(text).map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}

function Block({ b }: { b: MdBlock }): React.ReactElement {
  switch (b.t) {
    case "p":
      return <p>{inl(b.c)}</p>;
    case "h":
      return b.level <= 1 ? <h2 className="pt-3 text-2xl leading-tight font-bold text-zinc-900 dark:text-zinc-100">{inl(b.c)}</h2> : b.level === 2 ? <h3 className="pt-2 text-xl leading-snug font-semibold text-zinc-900 dark:text-zinc-100">{inl(b.c)}</h3> : <h4 className="pt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{inl(b.c)}</h4>;
    case "quote":
      return (
        <blockquote className="space-y-2 border-l-[3px] border-zinc-300 pl-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {b.c.map((x, i) => (
            <Block key={i} b={x} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i} className="pl-0.5">
          {inl(it.c)}
          {it.sub.map((s, k) => (
            <Block key={k} b={s} />
          ))}
        </li>
      ));
      return b.ordered ? <ol className="list-decimal space-y-0.5 pl-6">{items}</ol> : <ul className="list-disc space-y-0.5 pl-6">{items}</ul>;
    }
    case "code":
    case "math":
      return <pre className="overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 font-mono text-[13px] leading-normal text-zinc-100">{b.v}</pre>;
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
                    {inl(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, k) => (
                    <td key={k} className="px-3 py-2 align-top">
                      {inl(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="my-4 border-zinc-300 dark:border-zinc-700" />;
  }
}

function inl(c: MdInline[]): React.ReactNode {
  return c.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "br":
        return <br key={i} />;
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {inl(n.c)}
          </strong>
        );
      case "em":
        return <em key={i}>{inl(n.c)}</em>;
      case "del":
        return <del key={i}>{inl(n.c)}</del>;
      case "code":
      case "math":
        return (
          <code key={i} className="rounded bg-zinc-500/15 px-1 py-0.5 font-mono text-[0.88em]">
            {n.v}
          </code>
        );
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer" className="text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
            {inl(n.c)}
          </a>
        );
      case "img":
        return (
          <span key={i} className="text-zinc-500">
            [{n.alt}]
          </span>
        );
    }
  });
}
