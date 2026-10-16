import { t } from "@/lib/i18n/server";
import { ApiError, str, type ApiContribution, type Params } from "@/lib/plugins/api-kit";
import { asAgent } from "./agent-scope";
import { docText, markdownToDoc, type DocNode } from "./doc";
import { newId, type Property } from "./model";
import { addRow, createPage, getDatabase, getPage, isProtectedPage, rawRows, setCell, tree, updatePage, updateSchema } from "./store";

/**
 * The Workspace's part of the plugin API — and of the auto actions ("zeff-do"): a row added to a database or changed (by the
 * database's, the row's and the fields' names), a page made or written on. The AI is given the databases with their fields
 * (and the pages) as context, so it names what is there.
 */

const lower = (s: string) => s.trim().toLowerCase();

/** A database by its id or its name (exact, else the one name that contains it). */
function findDatabase(v: string): number | null {
  const id = Number(v);
  if (Number.isInteger(id) && id > 0 && getDatabase(id)) return id;
  const dbs = tree().filter((p) => p.kind === "database" && !p.system);
  const want = lower(v);
  if (!want) return null;
  const exact = dbs.find((p) => lower(p.title) === want);
  if (exact) return exact.id;
  const some = dbs.filter((p) => lower(p.title).includes(want));
  return some.length === 1 ? some[0].id : null;
}

/** A row of a database by its id or its title (exact, else the one that contains it). */
function findRow(dbId: number, v: string): number | null {
  const id = Number(v);
  const rows = rawRows(dbId);
  if (Number.isInteger(id) && rows.some((r) => r.id === id)) return id;
  const want = lower(v);
  if (!want) return null;
  const exact = rows.find((r) => lower(r.title) === want);
  if (exact) return exact.id;
  const some = rows.filter((r) => lower(r.title).includes(want));
  return some.length === 1 ? some[0].id : null;
}

/** A page (not a database) by its id or its title. */
function findPage(v: string): number | null {
  const id = Number(v);
  if (Number.isInteger(id) && id > 0 && getPage(id) && !getPage(id)!.archivedAt && !isProtectedPage(id)) return id;
  const want = lower(v);
  if (!want) return null;
  const pages = tree().filter((p) => p.kind === "page" && !isProtectedPage(p.id));
  return pages.find((p) => lower(p.title) === want)?.id ?? (pages.filter((p) => lower(p.title).includes(want)).length === 1 ? pages.find((p) => lower(p.title).includes(want))!.id : null);
}

/** Fields as the AI writes them (a JSON object of name → value, as text). */
function fieldsOf(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : typeof v === "boolean" || typeof v === "number" ? String(v) : ""]));
  } catch {
    return {};
  }
}

const YES = new Set(["yes", "ja", "true", "1", "x", "✓"]);

/** A row's fields set by their names: a select's / status' option by its name (made when new), a date, a checkbox … */
/** A row's fields set by their names (also the pipelines' write step). */
export function setFields(dbId: number, rowId: number, fields: Record<string, string>): void {
  for (const [name, value] of Object.entries(fields)) {
    const d = getDatabase(dbId)!;
    if (lower(name) === lower(d.schema.titleName) || ["title", "titel", "name"].includes(lower(name))) {
      if (value.trim()) updatePage(rowId, { title: value.trim() });
      continue;
    }
    const p = d.schema.properties.find((x) => lower(x.name) === lower(name));
    if (!p) continue;
    const option = (prop: Property, n: string): string => {
      const known = prop.options?.find((o) => lower(o.name) === lower(n));
      if (known) return known.id;
      const o = { id: newId("o"), name: n.trim(), color: "gray", ...(prop.type === "status" ? { group: "todo" as const } : {}) };
      const cur = getDatabase(dbId)!.schema;
      updateSchema(dbId, { ...cur, properties: cur.properties.map((x) => (x.id === prop.id ? { ...x, options: [...(x.options ?? []), o] } : x)) });
      return o.id;
    };
    if (p.type === "select" || p.type === "status") setCell(rowId, p.id, value.trim() ? option(p, value) : null);
    else if (p.type === "multi_select") setCell(rowId, p.id, value.split(",").map((x) => x.trim()).filter(Boolean).map((x) => option(getDatabase(dbId)!.schema.properties.find((y) => y.id === p.id)!, x)));
    else if (p.type === "checkbox") setCell(rowId, p.id, YES.has(lower(value)));
    else if (p.type === "number") setCell(rowId, p.id, Number.isFinite(Number(value)) ? Number(value) : null);
    else if (["text", "markdown", "url", "email", "phone", "date"].includes(p.type)) setCell(rowId, p.id, value.trim() || null);
  }
}

/** Text added at a page's end (Markdown). */
function append(pageId: number, markdown: string): void {
  if (!markdown.trim()) return;
  const p = getPage(pageId)!;
  const more = markdownToDoc(markdown).content ?? [];
  updatePage(pageId, { content: { ...p.content, content: [...((p.content.content ?? []) as DocNode[]), ...more] } });
}

/** The databases (and their fields, a select's options) and the pages — what the AI names; the ones the text mentions first. */
function context(q: { ticket: string; text: string }): string[] {
  const text = lower(q.text);
  const dbs = tree().filter((p) => p.kind === "database" && !p.system);
  const mentioned = (title: string) => title.split(/\s+/).some((w) => w.length > 3 && text.includes(lower(w)));
  const ordered = [...dbs.filter((d) => mentioned(d.title)), ...dbs.filter((d) => !mentioned(d.title))].slice(0, 25);
  const kind: Record<string, string> = { status: "Status", select: "Auswahl", multi_select: "Mehrfachauswahl", date: "Datum", checkbox: "Häkchen", number: "Zahl", text: "Text", url: "Link" };
  const lines = ordered.map((d) => {
    const s = getDatabase(d.id)!.schema;
    const fields = s.properties
      .filter((p) => kind[p.type] && !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id))
      .map((p) => `${p.name} (${kind[p.type]}${p.options?.length ? `: ${p.options.slice(0, 12).map((o) => o.name).join(", ")}` : ""})`)
      .join("; ");
    return `Workspace-Datenbank „${d.title}“ — Titel-Feld: ${s.titleName}${fields ? `; Felder: ${fields}` : ""}`;
  });
  const pages = tree().filter((p) => p.kind === "page" && !p.system).slice(0, 40).map((p) => p.title || t("Untitled"));
  return [...lines, ...(pages.length ? [`Workspace-Seiten: ${pages.join(" · ")}`] : [])];
}

const ok = <T extends Params>(p: T): T | null => p;

const RAW_API: ApiContribution = {
  permissions: () => ({ "workspace.write": t("Add and change pages and rows of the Workspace") }),
  methods: {
    "workspace.rows.add": {
      perm: "workspace.write",
      summary: "A row in a database (database: its name or id; title; fields: a JSON object name → value; markdown: its page's text).",
      run: async (p) => {
        const db = findDatabase(str(p, "database", { required: true, max: 200 }));
        if (!db) throw new ApiError("not_found", "database: no such database");
        const id = addRow(db, { title: str(p, "title", { max: 500 }) });
        setFields(db, id, fieldsOf(str(p, "fields", { max: 8000 })));
        append(id, str(p, "markdown", { max: 20000 }));
        return { id };
      },
      offer: {
        label: "Add a row to a Workspace database",
        when: "Etwas gehört als Eintrag in eine Datenbank meines Workspace (ein Board, eine Liste, eine Sammlung — siehe die Datenbanken unten mit ihren Feldern): eine Aufgabe, ein Termin, eine Idee, ein Rezept, eine Bestellung …",
        fields: {
          database: "der Name der Datenbank, genau wie unten",
          title: "der Titel des Eintrags",
          fields: 'optional: ein JSON-Objekt (als Text) Feldname → Wert, nur Felder der Datenbank, Auswahl-Werte wie unten (Datum JJJJ-MM-TT, Häkchen ja/nein), z. B. {"Status": "Offen"}',
          markdown: "optional: der Text des Eintrags (Markdown)",
        },
        example: { database: "Einkauf", title: "Milch", fields: '{"Status": "Offen"}', markdown: "" },
        check: (raw) => {
          const database = findDatabase(raw.database ?? "");
          const title = (raw.title ?? "").trim().slice(0, 500);
          return database && title ? ok({ database: String(database), title, fields: raw.fields ?? "", markdown: (raw.markdown ?? "").slice(0, 20000) }) : null;
        },
        describe: (p) => ({ title: t("“{title}” into {database}", { title: String(p.title), database: getPage(Number(p.database))?.title ?? String(p.database) }), body: [Object.entries(fieldsOf(String(p.fields ?? ""))).map(([k, v]) => `${k}: ${v}`).join(" · "), String(p.markdown ?? "")].filter(Boolean).join("\n\n") }),
        context,
      },
    },
    "workspace.rows.update": {
      perm: "workspace.write",
      summary: "A row of a database changed (database, row: its title or id; fields: JSON name → value; markdown: text added to its page).",
      run: async (p) => {
        const db = findDatabase(str(p, "database", { required: true, max: 200 }));
        if (!db) throw new ApiError("not_found", "database: no such database");
        const row = findRow(db, str(p, "row", { required: true, max: 500 }));
        if (!row) throw new ApiError("not_found", "row: no such row");
        setFields(db, row, fieldsOf(str(p, "fields", { max: 8000 })));
        append(row, str(p, "markdown", { max: 20000 }));
        return { id: row };
      },
      offer: {
        label: "Change a row of a Workspace database",
        when: "Ein bestehender Eintrag einer Datenbank meines Workspace muss sich ändern (Status weiter, ein Datum, ein Feld) oder bekommt eine Notiz dazu.",
        fields: {
          database: "der Name der Datenbank, genau wie unten",
          row: "der Titel des Eintrags",
          fields: 'optional: ein JSON-Objekt (als Text) Feldname → neuer Wert, z. B. {"Status": "Erledigt"}',
          markdown: "optional: Text, der an den Eintrag angehängt wird",
        },
        example: { database: "Projekte", row: "Relaunch", fields: '{"Status": "In Arbeit"}', markdown: "" },
        check: (raw) => {
          const database = findDatabase(raw.database ?? "");
          const row = database ? findRow(database, raw.row ?? "") : null;
          return database && row && ((raw.fields ?? "").trim() || (raw.markdown ?? "").trim()) ? ok({ database: String(database), row: String(row), fields: raw.fields ?? "", markdown: (raw.markdown ?? "").slice(0, 20000) }) : null;
        },
        describe: (p) => ({ title: t("Change “{row}”", { row: getPage(Number(p.row))?.title ?? String(p.row) }), body: [Object.entries(fieldsOf(String(p.fields ?? ""))).map(([k, v]) => `${k}: ${v}`).join(" · "), String(p.markdown ?? "")].filter(Boolean).join("\n\n") }),
        context,
      },
    },
    "workspace.pages.create": {
      perm: "workspace.write",
      summary: "A page (title; parent: a page's title or id; markdown: its text).",
      run: async (p) => {
        const parent = str(p, "parent", { max: 200 });
        const parentId = parent ? findPage(parent) : null;
        const id = createPage({ title: str(p, "title", { required: true, max: 300 }), parentId, content: markdownToDoc(str(p, "markdown", { max: 50000 })) });
        return { id };
      },
      offer: {
        label: "Make a Workspace page",
        when: "Etwas soll als eigene Seite in meinen Workspace (ein Protokoll, eine Zusammenfassung, eine Notiz, ein Plan) — mit fertigem Text.",
        fields: { title: "der Titel der Seite", parent: "optional: der Titel der Seite, unter die sie gehört (siehe unten)", markdown: "der Text (Markdown)" },
        example: { title: "Protokoll Abstimmung 16.10.", parent: "", markdown: "## Ergebnis\n- …" },
        check: (raw) => ((raw.title ?? "").trim() ? ok({ title: raw.title!.trim().slice(0, 300), parent: (raw.parent ?? "").trim(), markdown: (raw.markdown ?? "").slice(0, 50000) }) : null),
        describe: (p) => ({ title: t("New page “{title}”", { title: String(p.title) }), body: String(p.markdown ?? "") }),
        context,
      },
    },
    "workspace.pages.append": {
      perm: "workspace.write",
      summary: "Text added at a page's end (page: its title or id; markdown).",
      run: async (p) => {
        const page = findPage(str(p, "page", { required: true, max: 300 }));
        if (!page) throw new ApiError("not_found", "page: no such page");
        append(page, str(p, "markdown", { required: true, max: 50000 }));
        return { id: page, text: docText(getPage(page)!.content).length };
      },
      offer: {
        label: "Write on a Workspace page",
        when: "Etwas gehört auf eine bestehende Seite meines Workspace (siehe unten) — angehängt an ihr Ende.",
        fields: { page: "der Titel der Seite, genau wie unten", markdown: "der Text, der angehängt wird (Markdown)" },
        example: { page: "Einkauf", markdown: "- Brot" },
        check: (raw) => {
          const page = findPage(raw.page ?? "");
          return page && (raw.markdown ?? "").trim() ? ok({ page: String(page), markdown: raw.markdown!.slice(0, 50000) }) : null;
        },
        describe: (p) => ({ title: t("Add to “{page}”", { page: getPage(Number(p.page))?.title ?? String(p.page) }), body: String(p.markdown ?? "") }),
        context,
      },
    },
  },
};

/** The methods, each run as the AI (system pages read-only) — whoever calls them: an auto action, a plugin, an agent. */
export const WORKSPACE_API: ApiContribution = { ...RAW_API, methods: Object.fromEntries(Object.entries(RAW_API.methods).map(([name, m]) => [name, { ...m, run: asAgent(m.run) }])) };
