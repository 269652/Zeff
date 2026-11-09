import { Fragment, useRef, useState } from "react";
import type { RPage } from "@/lib/replica/shared";
import { docToMarkdown, markdownEditable, markdownToDoc } from "@/plugins/workspace/doc";
import { normalizeSchema, type DbSchema, type Property } from "@/plugins/workspace/model/schema";
import { cellText } from "@/plugins/workspace/model/values";
import { parseMarkdown, type MdBlock, type MdInline } from "@/lib/markdown";
import { useReplica } from "./main";
import { tr } from "./words";

const pageKey = (id: number | string) => `page:${id}`;
const byPosition = (a: RPage, b: RPage) => a.position - b.position || String(a.title).localeCompare(String(b.title));
const titleOf = (p: RPage) => (p.icon ? `${p.icon} ` : "") + (p.title || tr("Untitled"));

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
  if (open && !page) return <Tree go={go} />;
  return page ? <PageView page={page} go={go} /> : <Tree go={go} />;
}

function Tree({ go }: { go: (id: string | null) => void }) {
  const { engine, edit } = useReplica();
  const pages = engine.list("page").filter((p) => p.dbId === null);
  const kids = (id: number | null) => pages.filter((p) => p.parentId === id).sort(byPosition);
  const favorites = pages.filter((p) => p.favorite).sort(byPosition);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const node = (p: RPage, depth: number): React.ReactNode => {
    const children = kids(p.id);
    const id = String(p.id);
    return (
      <Fragment key={id}>
        <li className="zo-tree-row" style={{ paddingLeft: depth * 16 }}>
          {children.length ? (
            <button type="button" className="zo-twist" aria-expanded={expanded.has(id)} aria-label={titleOf(p)} onClick={() => toggle(id)}>
              {expanded.has(id) ? "▾" : "▸"}
            </button>
          ) : (
            <span className="zo-twist" />
          )}
          <button type="button" className="zo-link" onClick={() => go(id)}>
            {p.kind === "database" && !p.icon ? "▦ " : ""}
            {titleOf(p)}
          </button>
        </li>
        {expanded.has(id) && children.map((c) => node(c, depth + 1))}
      </Fragment>
    );
  };
  return (
    <div className="zo-page">
      {favorites.length > 0 && (
        <>
          <h2 className="zo-h">{tr("Favorites")}</h2>
          <ul className="zo-list">
            {favorites.map((p) => (
              <li key={p.id} className="zo-tree-row">
                <button type="button" className="zo-link" onClick={() => go(String(p.id))}>
                  {titleOf(p)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="zo-h">{tr("Pages")}</h2>
      <ul className="zo-list">{kids(null).map((p) => node(p, 0))}</ul>
      <button
        type="button"
        className="zo-btn"
        onClick={async () => {
          const tmp = await edit({ kind: "page.add", parent: null, title: "" });
          if (tmp) go(tmp);
        }}
      >
        + {tr("New page")}
      </button>
    </div>
  );
}

function PageView({ page, go }: { page: RPage; go: (id: string | null) => void }) {
  const { engine, edit } = useReplica();
  // Your title while you type (null: the page's own).
  const [draft, setDraft] = useState<string | null>(null);
  const title = draft ?? page.title;
  const parent = page.dbId ?? page.parentId;
  const sub = engine
    .list("page")
    .filter((p) => p.parentId === page.id && p.dbId === null)
    .sort(byPosition);
  const db = page.dbId ? engine.get<"page">(pageKey(page.dbId)) : undefined;
  const schema = db?.schema ? normalizeSchema(db.schema) : null;
  return (
    <div className="zo-page">
      <button type="button" className="zo-back" onClick={() => go(parent === null ? null : String(parent))}>
        ← {tr("Back")}
      </button>
      {page.locked && <p className="zo-muted">🔒 {tr("locked")}</p>}
      <input
        className="zo-title"
        value={title}
        placeholder={tr("Untitled")}
        aria-label={tr("Title")}
        readOnly={page.locked}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== page.title) void edit({ kind: "page.set", page: page.id, field: "title", value: draft });
          setDraft(null);
        }}
      />
      {schema && <RowFields row={page} schema={schema} />}
      {page.kind === "database" ? <DatabaseView db={page} go={go} /> : <Body page={page} />}
      {page.kind !== "database" && !page.dbId && (
        <>
          {sub.length > 0 && <h2 className="zo-h">{tr("Subpages")}</h2>}
          <ul className="zo-list">
            {sub.map((p) => (
              <li key={p.id} className="zo-tree-row">
                <button type="button" className="zo-link" onClick={() => go(String(p.id))}>
                  {titleOf(p)}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="zo-btn"
            onClick={async () => {
              const tmp = await edit({ kind: "page.add", parent: page.id, title: "" });
              if (tmp) go(tmp);
            }}
          >
            + {tr("New subpage")}
          </button>
        </>
      )}
      {!page.locked && (
        <button
          type="button"
          className="zo-btn zo-danger"
          onClick={() => {
            if (!confirm(`${tr("To the trash")}: ${titleOf(page)}?`)) return;
            void edit({ kind: "page.archive", page: page.id });
            go(parent === null ? null : String(parent));
          }}
        >
          {tr("To the trash")}
        </button>
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
      <div className="zo-body">
        <textarea
          className="zo-editor"
          value={text}
          autoFocus
          rows={Math.max(8, text.split("\n").length + 2)}
          onChange={(e) => {
            setText(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            const v = e.target.value;
            timer.current = setTimeout(() => save(v), 2000);
          }}
        />
        <button
          type="button"
          className="zo-btn primary"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            save(text);
            setText(null);
          }}
        >
          {tr("Done2")}
        </button>
      </div>
    );
  return (
    <div className="zo-body">
      <Markdown text={md} />
      {!editable && !page.locked && <p className="zo-muted">{tr("pcOnlyBody")}</p>}
      {editable && (
        <button type="button" className="zo-btn" onClick={() => setText(md)}>
          ✎ {tr("Edit")}
        </button>
      )}
    </div>
  );
}

/** A database: its rows as a list (table) or in columns (board, by its board view's grouping). */
function DatabaseView({ db, go }: { db: RPage; go: (id: string | null) => void }) {
  const { engine, edit } = useReplica();
  const schema = normalizeSchema(db.schema);
  // A board by its board view's grouping — else by its first status (or select) field, so a list of tasks is a board here too.
  const groupBy = schema.views.find((v) => v.type === "board" && v.groupBy)?.groupBy ?? (schema.properties.find((p) => p.type === "status") ?? schema.properties.find((p) => p.type === "select"))?.id;
  const board = groupBy ? { groupBy } : null;
  const [mode, setMode] = useState<"table" | "board">(schema.views.some((v) => v.type === "board") ? "board" : "table");
  const rows = engine
    .list("page")
    .filter((p) => p.dbId === db.id)
    .sort(byPosition);
  const view = schema.views.find((v) => v.type === "table") ?? schema.views[0];
  const shownProps = schema.properties.filter((p) => !view?.hidden.includes(p.id)).slice(0, 3);
  const add = async (cells: Record<string, unknown> = {}) => {
    const tmp = await edit({ kind: "row.add", db: db.id, title: "", cells });
    if (tmp) go(tmp);
  };
  return (
    <div>
      {board && (
        <div className="zo-seg" role="tablist">
          {(["board", "table"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {tr(m === "board" ? "Board" : "Table")}
            </button>
          ))}
        </div>
      )}
      {mode === "board" && board ? (
        <Board rows={rows} schema={schema} groupBy={board.groupBy!} go={go} add={add} />
      ) : (
        <>
          {!rows.length && <p className="zo-muted">{tr("noRows")}</p>}
          <ul className="zo-list">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" className="zo-row" onClick={() => go(String(r.id))}>
                  <strong>{titleOf(r)}</strong>
                  <small>
                    {shownProps
                      .map((p) => cellText(p, r.props[p.id]))
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="zo-btn" onClick={() => void add()}>
            + {tr("New")}
          </button>
        </>
      )}
    </div>
  );
}

function Board({ rows, schema, groupBy, go, add }: { rows: RPage[]; schema: DbSchema; groupBy: string; go: (id: string | null) => void; add: (cells?: Record<string, unknown>) => void }) {
  const prop = schema.properties.find((p) => p.id === groupBy);
  const options = prop?.options ?? [];
  const cols = [...options.map((o) => ({ id: o.id as string | null, name: o.name })), { id: null, name: tr("No value") }];
  return (
    <div className="zo-board">
      {cols.map((c) => {
        const inCol = rows.filter((r) => (r.props[groupBy] ?? null) === c.id || (c.id === null && !options.some((o) => o.id === r.props[groupBy])));
        if (c.id === null && !inCol.length) return null;
        return (
          <section key={String(c.id)} className="zo-col">
            <h3>
              {c.name} <span>{inCol.length}</span>
            </h3>
            {inCol.map((r) => (
              <button key={r.id} type="button" className="zo-card" onClick={() => go(String(r.id))}>
                {titleOf(r)}
              </button>
            ))}
            {c.id !== null && (
              <button type="button" className="zo-btn" onClick={() => add({ [groupBy]: c.id })}>
                + {tr("New")}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

const EDITABLE = new Set(["text", "markdown", "url", "email", "phone", "number", "select", "status", "multi_select", "checkbox", "date"]);

/** A row's fields: the simple kinds editable here, the rest shown as they are (changed on the PC). */
function RowFields({ row, schema }: { row: RPage; schema: DbSchema }) {
  const { edit } = useReplica();
  const set = (p: Property, value: unknown) => void edit({ kind: "row.cell", row: row.id, prop: p.id, value });
  return (
    <div className="zo-fields">
      {schema.properties.map((p) => {
        const v = row.props[p.id] ?? null;
        return (
          <label key={p.id} className="zo-field">
            <span>{p.name}</span>
            {EDITABLE.has(p.type) && !row.locked ? <FieldInput p={p} v={v} set={(x) => set(p, x)} /> : <output title={tr("readOnlyField")}>{cellText(p, v) || tr("No value")}</output>}
          </label>
        );
      })}
    </div>
  );
}

function FieldInput({ p, v, set }: { p: Property; v: unknown; set: (v: unknown) => void }) {
  // What you type (null: the field's own value).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (v === null || v === undefined || typeof v === "object" ? "" : String(v));
  const setText = setDraft;
  switch (p.type) {
    case "checkbox":
      return <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />;
    case "select":
    case "status":
      return (
        <select value={typeof v === "string" ? v : ""} onChange={(e) => set(e.target.value || null)}>
          <option value="">{tr("No value")}</option>
          {(p.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case "multi_select": {
      const have = new Set(Array.isArray(v) ? (v as string[]) : []);
      return (
        <span className="zo-chips">
          {(p.options ?? []).map((o) => (
            <label key={o.id} className="zo-chip">
              <input
                type="checkbox"
                checked={have.has(o.id)}
                onChange={(e) => {
                  const next = new Set(have);
                  if (e.target.checked) next.add(o.id);
                  else next.delete(o.id);
                  set([...next]);
                }}
              />
              {o.name}
            </label>
          ))}
        </span>
      );
    }
    case "date": {
      const start = typeof v === "string" ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String((v as { start: string }).start).slice(0, 10) : "";
      return <input type="date" value={start} onChange={(e) => set(e.target.value || null)} />;
    }
    case "number":
      return <input type="number" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => (draft !== null && set(draft.trim() === "" ? null : Number(draft)), setDraft(null))} />;
    default:
      return <input type={p.type === "url" ? "url" : p.type === "email" ? "email" : p.type === "phone" ? "tel" : "text"} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => (draft !== null && draft !== (v ?? "") && set(draft || null), setDraft(null))} />;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Markdown shown (src/lib/markdown.ts's blocks; formulas as their TeX)
// ---------------------------------------------------------------------------------------------------------------------

function Markdown({ text }: { text: string }) {
  return <div className="zo-md">{parseMarkdown(text).map((b, i) => <Block key={i} b={b} />)}</div>;
}

function Block({ b }: { b: MdBlock }): React.ReactElement {
  switch (b.t) {
    case "p":
      return <p>{inl(b.c)}</p>;
    case "h":
      return b.level <= 1 ? <h2>{inl(b.c)}</h2> : <h3>{inl(b.c)}</h3>;
    case "quote":
      return (
        <blockquote>
          {b.c.map((x, i) => (
            <Block key={i} b={x} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>
          {inl(it.c)}
          {it.sub.map((s, k) => (
            <Block key={k} b={s} />
          ))}
        </li>
      ));
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
    case "math":
      return <pre>{b.v}</pre>;
    case "table":
      return (
        <div className="zo-scroll">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>{inl(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, k) => (
                    <td key={k}>{inl(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr />;
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
        return <strong key={i}>{inl(n.c)}</strong>;
      case "em":
        return <em key={i}>{inl(n.c)}</em>;
      case "del":
        return <del key={i}>{inl(n.c)}</del>;
      case "code":
      case "math":
        return <code key={i}>{n.v}</code>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer">
            {inl(n.c)}
          </a>
        );
      case "img":
        return <span key={i}>[{n.alt}]</span>;
    }
  });
}
