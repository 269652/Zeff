/**
 * Agenda's port, kept in step with the built-in: its page template (src/plugins/agenda/template.ts — the projects, the notes, their
 * fields and the three example notes) made in an empty Zeff, its screen the built-in's own made of the view language alone
 * (agendaScreenPort: the sidebar from the plugin's lambda, the new-note form a dialog), the flow that adds a note beside it — exported as
 * the plugin's package (zeff-plugins/plugins/agenda-ext/agenda.package.json), made in the user's language when it is installed
 * (`localize`). One source: what changes in the built-in's template changes in the port's package when it is made again.
 *
 *   npx tsx scripts/port-agenda.mts [<zeff-plugins folder>]     (default ../zeff-plugins)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? "../zeff-plugins");
const out = path.join(repo, "plugins", "agenda-ext", "agenda.package.json");
// An empty Zeff of its own, in English.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-port-agenda-"));
process.env.DATABASE_PATH = path.join(tmp, "zeff.db");

const { setInstalled } = await import("../src/plugins/state");
setInstalled("workspace", true);
setInstalled("agenda", true);
const { agendaPage } = await import("../src/plugins/agenda/template");
const { ADD_NOTE_FLOW, AGENDA_PORT, agendaNames, agendaScreenPort } = await import("../src/plugins/agenda/view-template.meta");
const store = await import("../src/plugins/workspace/store");
const { createFlow } = await import("../src/plugins/workspace/flows/store");
const { exportPackage } = await import("../src/plugins/workspace/packages");
const { t } = await import("../src/lib/i18n/server");

const root = agendaPage(null);
const dbs = store.tree().filter((p) => p.kind === "database");
const notes = dbs.map((p) => store.getDatabase(p.id)!).find((d) => d.schema.dataType === "agenda")!;
// Its screen: the port's (the names its fields have here).
const n = { ...agendaNames(t), event: "" };
store.updateSchema(notes.page.id, { ...notes.schema, views: notes.schema.views.map((v) => (v.app === "agenda" ? { ...v, app: "template", template: agendaScreenPort(n, t) } : v)) });
// The flow that adds a note, beside the databases.
createFlow({ ...ADD_NOTE_FLOW, permissions: {} }, root);

const pkg = exportPackage(root, { name: "Agenda", description: "Notes on a timeline, in projects, like the app Agenda: a date or a range, on the agenda, pinned, done, tags and people; the text, checklists and pictures are the note's page.", icon: "📒", includeRows: true });
const notesItem = pkg.items.find((i) => i.kind === "database" && i.schema?.dataType === "agenda")!;
const flowItem = pkg.items.find((i) => i.flow && (i.flow as { name?: string }).name === AGENDA_PORT.addNote)!;
// The flow may write the package's own notes — by its place in the package, whatever id it gets.
(flowItem.flow as Record<string, unknown>).requested = { write: [`@${AGENDA_PORT.plugin}.${notesItem.id}`] };
const full = { ...pkg, id: AGENDA_PORT.plugin, version: "1.0.0", localize: true };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(full, null, 2) + "\n");
console.log(`${out}: ${full.items.length} items (notes ${notesItem.id}, flow ${flowItem.id})`);
