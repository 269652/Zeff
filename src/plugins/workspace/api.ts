import { isPackageRef, packagePage } from "./package-refs";
import { t } from "@/lib/i18n/server";
import { ApiError, str, type ApiContribution, type Params } from "@/lib/plugins/api-kit";
import { asAgent } from "./agent-scope";
import { docText, markdownToDoc, type DocNode } from "./doc";
import { newId, type Property } from "./model";
import { listRoutines } from "./routines";
import { addRow, createPage, getDatabase, getPage, isProtectedPage, rawRows, setCell, tree, updatePage, updateSchema } from "./store";

/**
 * The Workspace's part of the plugin API — and of the auto actions ("zeff-do"): a row added to a database or changed (by the
 * database's, the row's and the fields' names), a page made or written on. The AI is given the databases with their fields
 * (and the pages) as context, so it names what is there.
 */

const lower = (s: string) => s.trim().toLowerCase();

/** A database by its id or its name (exact, else the one name that contains it). */
export function findDatabase(v: string): number | null {
  // ("@my-pkg.i3": a database of an installed package by its place in it.)
  if (isPackageRef(v)) {
    const own = packagePage(v);
    return own !== null && getDatabase(own) ? own : null;
  }
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
export function findRow(dbId: number, v: string): number | null {
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

/** A routine (an automation or an agent) by its page's id or its title. */
function findRoutine(v: string): number | null {
  const id = Number(v);
  const routines = listRoutines();
  if (Number.isInteger(id) && routines.some((r) => r.pageId === id)) return id;
  const want = lower(v);
  if (!want) return null;
  const exact = routines.find((r) => lower(r.title) === want);
  if (exact) return exact.pageId;
  const some = routines.filter((r) => lower(r.title).includes(want));
  return some.length === 1 ? some[0].pageId : null;
}

function routinesContext(): string[] {
  const list = listRoutines();
  return list.length ? [`Workspace-Routinen: ${list.map((r) => `${r.title} (${r.kind === "agent" ? "Agent" : "Automation"})`).join(" · ")}`] : [];
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
    "workspace.widgets.check": {
      automatic: true,
      summary: "Whether a widget can be shown (html, libs), an exercise set is right (spec: an object or JSON text) or an exercise in the view language draws (view: a template, it must report with <button action=\"report\">): { ok, problems, libs, html } — html is the exercise set made into a widget.",
      run: async (p) => {
        const { checkWidgetHtml, WIDGET_LIBS } = await import("@/lib/widgets/sandbox");
        const { checkSpec, specHtml } = await import("@/lib/widgets/spec");
        let spec: unknown = p.spec;
        if (typeof spec === "string" && spec.trim()) {
          try {
            spec = JSON.parse(spec);
          } catch (e) {
            return { ok: false, problems: [`spec isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`], libs: [], html: "" };
          }
        }
        const libs = (Array.isArray(p.libs) ? p.libs : typeof p.libs === "string" ? p.libs.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
        const unknown = libs.filter((x) => !(x in WIDGET_LIBS));
        let html = typeof p.html === "string" ? p.html : "";
        const problems: string[] = unknown.map((x) => `no library "${x}" (there are: ${Object.keys(WIDGET_LIBS).join(", ")})`);
        // An exercise in the view language (view: a template, drawn in a <subview>): it must draw without a mistake and report its result.
        if (typeof p.view === "string" && p.view.trim()) {
          const { renderView } = await import("./view-template");
          const wrapped = `<subview template="{{ app.v }}" report="check"/>`;
          const r = renderView(wrapped, { rows: [], props: [], titleName: "Name", state: {}, app: { v: p.view }, data: {}, db: { id: 0, title: "" } });
          problems.push(...r.errors.map((e) => e.message.replace(/^<subview> /, "")));
          if (!/action\s*=\s*["']?report/.test(p.view)) problems.push('it never reports: a <button action="report" score="{{ … }}" finished=true> sends the result (score 0..1)');
          return { ok: problems.length === 0, problems, libs: [], html: "" };
        }
        if (spec !== undefined && spec !== null && spec !== "") {
          problems.push(...checkSpec(spec));
          if (!problems.length) {
            html = specHtml(spec as Parameters<typeof specHtml>[0]);
            if (/\$[^$]+\$/.test(JSON.stringify(spec))) libs.push("katex");
          }
        } else if (!html.trim()) problems.push("give either spec (an exercise set) or html (a widget of your own)");
        else {
          const c = checkWidgetHtml(html);
          if (!c.ok) problems.push(c.why);
        }
        return { ok: problems.length === 0, problems, libs: [...new Set(libs.filter((x) => x in WIDGET_LIBS))], html: problems.length ? "" : html };
      },
    },
    "workspace.widgets.guide": {
      automatic: true,
      summary: "How to write a widget, an exercise set and an exercise in the view language (what an AI that builds exercises reads): the three kinds and when to take which, the sandbox, the libraries, the bridge, the exercise kit's types.",
      run: async () => {
        const { WIDGET_GUIDE } = await import("@/lib/widgets/guide");
        const { KIT_GUIDE } = await import("@/lib/widgets/kit-guide");
        const { VIEW_EXERCISE_GUIDE } = await import("@/lib/widgets/view-exercise-guide");
        const { WIDGET_LIBS } = await import("@/lib/widgets/sandbox");
        return { guide: WIDGET_GUIDE, exercises: KIT_GUIDE, views: VIEW_EXERCISE_GUIDE, libs: Object.fromEntries(Object.entries(WIDGET_LIBS).map(([k, v]) => [k, v.what])) };
      },
    },
    "workspace.rows.add": {
      perm: "workspace.write",
      automatic: true,
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
      automatic: true,
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
      automatic: true,
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
    "workspace.routines.run": {
      perm: "workspace.write",
      automatic: true,
      summary: "A routine (an automation or an agent of the Workspace) run now (routine: its page's title or id; row: optional, a row's id it is about).",
      run: async (p) => {
        const page = findRoutine(str(p, "routine", { required: true, max: 300 }));
        if (!page) throw new ApiError("not_found", "routine: no such routine");
        const row = Number(str(p, "row", { max: 20 })) || undefined;
        const { runRoutine } = await import("./routine-run");
        const r = await runRoutine(page, { kind: "called" }, { row });
        return { id: page, status: r.status, ...(r.runId ? { run: r.runId } : {}), ...(r.error ? { error: r.error } : {}) };
      },
      offer: {
        label: "Run a Workspace routine",
        when: "Eine Routine meines Workspace (eine Automation oder ein Agent, siehe unten) soll jetzt laufen — etwa ein Agent, der einen Bericht schreibt, oder eine Automation, die Einträge aufräumt.",
        fields: { routine: "der Titel der Routine, genau wie unten" },
        example: { routine: "Wochenbericht" },
        check: (raw) => {
          const page = findRoutine(raw.routine ?? "");
          return page ? ok({ routine: String(page) }) : null;
        },
        describe: (p) => ({ title: t("Run “{routine}”", { routine: getPage(Number(p.routine))?.title ?? String(p.routine) }), body: "" }),
        context: () => routinesContext(),
      },
    },
    "workspace.signals.send": {
      perm: "workspace.write",
      automatic: true,
      summary: "A signal sent: the routines that listen to its name run (name: e.g. \"invoice.paid\"; payload: a JSON object of text values they can use as {{payload.x}}).",
      run: async (p) => {
        const name = str(p, "name", { required: true, max: 120 });
        let payload: Record<string, string> = {};
        try {
          const o = JSON.parse(str(p, "payload", { max: 4000 }) || "{}") as unknown;
          if (o && typeof o === "object" && !Array.isArray(o)) payload = Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)]));
        } catch {
          throw new ApiError("bad_request", "payload: a JSON object");
        }
        const { fireRoutineEvent } = await import("./routine-triggers");
        void fireRoutineEvent("signal", { name, payload }, { force: true }).catch(() => undefined);
        return { sent: name };
      },
      offer: {
        label: "Send a Workspace signal",
        when: "Etwas ist passiert, worauf andere Routinen meines Workspace hören sollen (z. B. eine Rechnung ist bezahlt) — als benanntes Signal.",
        fields: { name: "der Name des Signals, z. B. rechnung.bezahlt", payload: "optional: ein JSON-Objekt (als Text) mit Angaben, die die Routinen als Platzhalter nutzen" },
        example: { name: "rechnung.bezahlt", payload: '{"kunde": "Anna"}' },
        check: (raw) => ((raw.name ?? "").trim() ? ok({ name: raw.name!.trim().slice(0, 120), payload: raw.payload ?? "" }) : null),
        describe: (p) => ({ title: t("Signal “{name}”", { name: String(p.name) }), body: String(p.payload ?? "") }),
        context: () => [],
      },
    },
    "workspace.dossier.compile": {
      perm: "workspace.write",
      automatic: true,
      summary: "A database's dossier brought up to date (database: its title or id; focus: optional): only rows that changed are read.",
      run: async (p) => {
        const db = findDatabase(str(p, "database", { required: true, max: 300 }));
        if (!db) throw new ApiError("not_found", "database: no such database");
        return (await import("./dossier")).compileDatabase(db, { focus: str(p, "focus", { max: 500 }) || undefined });
      },
    },
    "workspace.pages.append": {
      perm: "workspace.write",
      automatic: true,
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
export const WORKSPACE_API: ApiContribution = { ...RAW_API, methods: Object.fromEntries(Object.entries(RAW_API.methods).map(([name, m]) => [name, { ...m, run: asAgent(m.run, `AI: ${name}`) }])) };
