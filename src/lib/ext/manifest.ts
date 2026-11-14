import path from "node:path";
import { z } from "zod";

/**
 * External plugins: a folder in <data>/plugins/<id>/ with a zeff-plugin.json — loaded when Zeff
 * runs, no rebuild, no source changes. This is the manifest's definition (docs/plugins/manifest.md
 * is its reference, docs/plugins/zeff-plugin.schema.json its JSON Schema, generated from here).
 *
 * Client-safe: no database, no file access.
 */

/** The version of the extension API this Zeff speaks (a plugin says which it was written for). */
export const API_VERSION = 1;

/**
 * What a plugin may be allowed to do — each named in its manifest, granted by you when you enable it.
 * A permission is an id like "work.read": Zeff brings `prompt`, `exec` and `network`; every plugin that
 * brings API methods brings the permissions they use (see lib/plugins/api.ts, GET /ext/docs for the list).
 */
export type Permission = string;
/** Set by lib/plugins/api-point.ts: whether some plugin brings the permission. Without it, every well-formed id passes. */
let permissionCheck: (p: string) => boolean = () => true;
export const setPermissionCheck = (fn: (p: string) => boolean) => {
  permissionCheck = fn;
};
const permissionId = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/, "a permission id like work.read or exec").refine((p) => permissionCheck(p), "no plugin brings this permission");

/**
 * The events a hook can listen to (docs/plugins/hooks.md). Like permissions they are brought by plugins
 * (Code: work.run.started, work.run.finished, work.changed; Todos: todos.changed; Kanban: kanban.changed …).
 */
export type ExtEvent = string;
let eventCheck: (e: string) => boolean = () => true;
/** Set by lib/plugins/api-point.ts: whether some plugin brings the event. */
export const setEventCheck = (fn: (e: string) => boolean) => {
  eventCheck = fn;
};
const eventId = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/, "an event name like work.run.finished").refine((e) => eventCheck(e), "no plugin brings this event");

/** Ids a plugin can't take: they're Zeff's own paths under /ext. */
export const RESERVED_IDS = ["sdk", "docs", "view", "raw"];

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, "lower-case letters, digits and dashes, starting with a letter (2–40 characters)")
  .refine((s) => !RESERVED_IDS.includes(s), "this id is reserved");

const shortId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "lower-case letters, digits and dashes, starting with a letter");

/** A path inside the plugin's folder: relative, no "..". */
const relPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !path.isAbsolute(p) && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes(".."), "a path inside the plugin's folder (relative, no ..)");

const mcpStdio = z.object({
  command: z.string().min(1).max(300).describe('The program. "node" is the Node that runs Zeff; "./x" is relative to the plugin folder.'),
  args: z.array(z.string().max(1000)).max(50).default([]),
  env: z.record(z.string(), z.string().max(2000)).default({}),
});
const mcpHttp = z.object({
  url: z.url({ protocol: /^https?$/ }).describe("An http(s) MCP endpoint."),
  headers: z.record(z.string(), z.string().max(2000)).default({}),
});

const command = z.object({
  id: shortId,
  label: z.string().min(1).max(40).describe('What the "/" menu shows.'),
  description: z.string().max(200).default(""),
  template: z.string().min(1).max(8000).describe("The text put into the message box when picked. May contain line breaks."),
});

const panel = z.object({
  id: shortId,
  title: z.string().min(1).max(40),
  entry: relPath.describe("The panel's HTML page, relative to the plugin's ui/ folder."),
  placement: z
    .enum(["tab", "session"])
    .default("tab")
    .describe('"tab": a view of its own, linked in Code\'s sidebar. "session": a drawer beside a session, which gets that session\'s ids.'),
});

const app = z.object({
  panel: shortId.describe("The id of one of the plugin's panels (workPanels) this entry opens."),
  label: z.string().min(1).max(30).describe("Its name in the menu."),
  short: z.string().min(1).max(12).describe("Its name in the header, when you put it there."),
  hint: z.string().max(80).default("").describe("A line under the name in the menu."),
});

const hook = z.object({
  command: z.array(z.string().max(1000)).min(1).max(50).describe('Program and arguments, no shell. "node" is the Node that runs Zeff; "./x" is relative to the plugin folder.'),
  timeoutMs: z.number().int().min(200).max(30000).default(5000),
});

const fnDecl = z.object({
  name: shortId.describe("Its name: how it is called (plugin id + this)."),
  title: z.string().max(80).default(""),
  description: z.string().max(300).default(""),
  runtime: z.enum(["python", "node"]).describe("The language of its file: it runs like a Notebook cell, in a Docker container (or on this computer), by the Notebook plugin."),
  file: relPath.describe("Its code, relative to the plugin folder. The arguments arrive as `inputs` (and as variables); what it returns — its last expression, or a top-level return — is the result."),
  input: z.record(z.string().max(60), z.string().max(200)).default({}).describe("The arguments it takes: name → what it is (documentation)."),
  needs: z.array(z.string().max(60)).max(30).default([]).describe("What of Zeff its code reads or changes through zeff.* (tables, metrics, outputs, databases, database:<id>, write:outputs, write:database:<id>, delete:database:<id>, meta:…, call:<plugin>.<name>): you grant them for the function in Settings → Notebook; without them the call is refused."),
  timeoutSeconds: z.number().int().min(1).max(600).default(60),
  webhook: z.boolean().default(false).describe("Programs outside Zeff may call it: POST /api/ext/hook/<plugin>/<name> with a secret you make in Settings → Notebook (only the functions that say so)."),
});

const flowActionDecl = z.object({
  name: shortId.describe("Its name in flows: <plugin id>.<this>."),
  label: z.string().min(1).max(60),
  summary: z.string().max(400).default("").describe("What it does — the Studio shows it and the AI reads it when it builds a flow."),
  group: z.string().max(30).default("plugin"),
  function: shortId.describe("The plugin function (contributes.functions) that does it: its arguments are the action's input, its result the action's output."),
  input: z
    .array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "letters, digits and _, starting with a letter").max(40), type: z.enum(["text", "number", "boolean", "json", "list", "date", "url"]).default("text"), label: z.string().max(60).optional(), required: z.boolean().optional(), help: z.string().max(200).optional() }))
    .max(20)
    .default([]),
  output: z.string().max(200).default("what the function returns"),
  writes: z.boolean().default(false).describe("It changes something: a dry run of a flow does not call it."),
});

const chatDecl = z.object({
  id: shortId,
  title: z.string().max(80).default(""),
  rules: relPath.describe("A text file with the agent's rules. {{name}} is replaced by what the context function gives (a list becomes lines); {{key}}, {{plugin}} and {{chat}} are always there."),
  context: shortId.optional().describe("The plugin function that gives the values for the rules, called with { key } each time a session starts."),
  tools: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/).max(60)).max(40).default([]).describe("Zeff's MCP tools the agent may use beside the chat's own (workspace_call_function calls the plugin's functions)."),
  conversation: z
    .object({
      database: z.string().max(60).describe("The database that keeps the conversation, one row per message: its id, or its place in the plugin's package (@my-pkg.i9)."),
      text: z.string().max(60).describe("The field with the message's text (the row's title column is a short form of it)."),
      role: z.string().max(60).describe("A choice field for who said it."),
      roles: z
        .object({ you: z.string().max(40).default("you"), agent: z.string().max(40).default("agent"), system: z.string().max(40).default("system") })
        .default({ you: "you", agent: "agent", system: "system" })
        .describe('The names of the choices in that field: the person, the agent ("teacher", "coach" …), what happened on the side.'),
      key: z.string().max(60).describe("The field that tells which key (which lesson, ticket …) the message belongs to."),
      kind: z.string().max(60).optional().describe('A choice field for the kind of message: "message" for what is said, and the kinds `watch` names.'),
      run: z.string().max(60).optional(),
      order: z.string().max(60).optional(),
      at: z.string().max(60).optional(),
      watch: z
        .array(z.object({ function: shortId, kind: z.string().min(1).max(40), field: z.string().max(60).optional() }))
        .max(10)
        .default([])
        .describe("Calls of the plugin's functions that are messages of their own, in the kind named (an exercise made, a step mastered): { function, kind, field? } — `field` is the argument whose value is the message's text."),
    })
    .optional()
    .describe("Keep the conversation in a database the person can edit: what is changed there is what the agent goes on with."),
});

const scheduleDecl = z.object({
  id: shortId,
  function: shortId.describe("The plugin function that is run."),
  everyMinutes: z.number().int().min(5).max(10080).describe("How often (5 minutes to a week), as long as Zeff is running and the plugin is on."),
  args: z.record(z.string().max(60), z.unknown()).default({}).describe("The arguments it is called with."),
});

/** An id its plugin's id is put in front of ("my-plugin.birds"): lower-case, digits, dots, dashes. */
const dotId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(60);

const lookupDecl = z.object({
  id: dotId.describe("How a template names it: <plugin id>.<this>."),
  label: z.string().min(1).max(60),
  what: z.string().max(300).default("").describe("One line: what it finds (the AI reads it)."),
  fields: z.record(z.string().max(60), z.string().max(200)).default({}).describe("The fields a hit has: name → what it is."),
  credit: z.string().max(200).optional(),
  slow: z.boolean().default(false),
  search: shortId.describe("The plugin function that searches: gets { query, language }, gives back a list of { id, title, subtitle?, image? }."),
  details: shortId.describe("The plugin function that reads one hit: gets { id, language }, gives back its fields by name (text, number, list of texts or null)."),
});

const sourceDecl = z.object({
  id: dotId.describe("Its id: <plugin id>.<this>."),
  label: z.string().min(1).max(60),
  icon: z.string().max(8).default("🔌"),
  hint: z.string().max(200).default("").describe("One line: what the records are."),
  read: shortId.describe("The plugin function that reads the records: gives back a list of { ref, title, key?, fields?, text?, url?, updatedAt? }."),
  noNewRows: z.boolean().default(true).describe("The records are only read from where they live: a row cannot be made by hand."),
});

const fieldTypeDecl = z.object({
  id: dotId.describe("Its id: <plugin id>.<this>."),
  label: z.string().min(1).max(40),
  icon: z.string().max(8).default("🏷️"),
  description: z.string().max(200).default(""),
  display: z.enum(["text", "rating", "progress", "badge", "link"]).default("text"),
  max: z.number().int().min(1).max(20).optional().describe("Stars, for the rating display."),
  href: z.string().max(300).optional().describe("A link's address with {value} in it."),
  kind: z.enum(["text", "number", "choice"]).default("text").describe("What an entry is: any text (checked by `pattern`), a number (between `min` and `max`) or one of `options`."),
  pattern: z.string().max(200).optional().describe("A regular expression a text entry must match."),
  min: z.number().optional(),
  maxValue: z.number().optional().describe("The largest number (kind number)."),
  options: z.array(z.string().max(60)).max(100).default([]),
});

// The stored forms of the Workspace's extension points (docs/kernel-contract.md): what a built-in plugin brings in TypeScript, an
// external plugin declares here — a formula, or a function of its own that answers.
const formulaFnDecl = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/, "a formula name: letters and digits, starting with a small letter"),
  args: z.array(z.string().regex(/^[a-zA-Z][\w]{0,39}$/)).max(8).default([]).describe('Its arguments, by name — read in `value` as prop("name").'),
  value: z.string().min(1).max(2000).describe('What it gives: a formula of Zeff\'s formula language, its arguments as prop("name") — no code, nothing it can change.'),
  what: z.string().max(200).default("").describe("One line: what it gives (the formula help and the AI read it)."),
  unit: z.string().max(20).optional(),
});
const metricDecl = z.object({
  id: shortId,
  label: z.string().min(1).max(60).describe("Its name as a Kennzahl (formulas read it with kennzahl(\"…\"))."),
  unit: z.string().max(20).default(""),
  what: z.string().max(200).default(""),
  function: shortId.describe("The plugin function that gives the number (called with {}); its last answer is what the Kennzahl shows."),
  everyMinutes: z.number().int().min(1).max(1440).default(15).describe("How old its last answer may be before it is asked again (in the background)."),
});
const rowBadgeDecl = z.object({
  prefix: z.string().regex(/^[a-z][a-z0-9-]{0,39}:$/, 'the start of its records\' refs, with the colon: "film:"').describe("The rows its sources brought (by their record's ref) it puts badges on."),
  function: shortId.describe('The plugin function that gives the badges: { "film:12": [{ "label": "2 new", "tone": "warn" }] }.'),
});
const tabMenuDecl = z.object({
  tab: z.string().regex(/^\/[\w/-]{0,80}$/).describe('The tab (by its address, "/my-app") whose menu it fills.'),
  function: shortId.describe("The plugin function that gives the entries: [{ href, label, hint? }]."),
});
const widgetSettingDecl = z.object({
  key: z.string().regex(/^[a-zA-Z][\w]{0,39}$/),
  label: z.string().min(1).max(60),
  kind: z.enum(["number", "select", "text", "checkbox"]).default("text"),
  default: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.object({ value: z.string().max(100), label: z.string().max(100) })).max(50).optional(),
  optionsFrom: z.enum(["series"]).optional().describe("A select's options from Zeff: \"series\" — the daily series you may see (your databases' fields first)."),
});
const widgetDecl = z.object({
  id: shortId.describe("Its id: <plugin id>.<this>."),
  label: z.string().min(1).max(60),
  icon: z.string().max(8).default("🧩"),
  description: z.string().max(200).default(""),
  size: z.enum(["third", "half", "full"]).default("half"),
  ttl: z.number().int().min(5).max(86400).default(60).describe("Seconds its data is kept."),
  replaces: z.string().regex(/^[a-z][a-z0-9-]*.[a-z0-9.-]+$/).max(80).optional().describe("A built-in widget's id this one takes over (a port): its id is that one then, so the widgets on your pages go on working; while the built-in is there, the built-in's counts."),
  settings: z.array(widgetSettingDecl).max(10).default([]),
  lambda: z.string().regex(/^[a-z][a-z0-9_-]*(.[a-z0-9_-]+)*$/).max(80).optional().describe("Or one of its lambdas (kind function), called the same way — no Notebook needed."),
  function: shortId.optional().describe('The plugin function that gives its data, called with { config }: { "kind": "list", "items": [{ id, text, detail?, meta?, href?, badge?, tone?, done?, actions? }] }, { "kind": "stats", "tiles": [{ label, value, detail?, tone?, href? }] } or { "kind": "figure", value, caption, detail?, href? }.'),
  actLambda: z.string().regex(/^[a-z][a-z0-9_-]*(.[a-z0-9_-]+)*$/).max(80).optional().describe("Or one of its lambdas for the buttons."),
  act: shortId.optional().describe("The plugin function a button of it runs, called with { action, payload, config }; what it gives (data as above) is shown, else the data is read again."),
});
const pageNavDecl = z.object({
  function: shortId.describe("The plugin function that gives entries under pages in the Workspace tree: [{ pageId, entries: [{ id, label, icon?, n?, group?, href? }] }]."),
});
const reviewSourceDecl = z.object({
  id: shortId.describe("Its id: <plugin id>-<this> in the review queue."),
  label: z.string().min(1).max(60),
  list: shortId.describe("The plugin function that gives what waits for a word: [{ id, title, detail?, confidence?, href?, actions: [{ id, label, primary? }] }]."),
  act: shortId.describe("The plugin function a button runs, called with { item, action }; what it gives (a text) is said."),
});
const toolDecl = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, "a tool name: lower-case letters, digits and _, 3–41 characters (web_search)").describe("Its name among Zeff's tools — one Zeff or another plugin already has is left out."),
  title: z.string().max(80).default(""),
  description: z.string().min(1).max(1500).describe("What it does and when the AI should use it — the AI reads only this."),
  function: shortId.optional().describe("The plugin function that does it: called with the arguments; what it returns is the answer (text, or JSON)."),
  lambda: z.string().regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/).max(80).optional().describe("Or one of its lambdas (contributes.lambdas, kind function) — runs without the Notebook: a Node process of its own, only the domains it names."),
  input: z
    .array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(40), type: z.enum(["text", "number", "boolean", "json", "list"]).default("text"), description: z.string().max(300).default(""), required: z.boolean().default(false) }))
    .max(20)
    .default([]),
  readOnly: z.boolean().default(false).describe("It only reads: the AI may call it without asking where its tools are limited to reading."),
});
const settingDecl = z.object({
  key: z.string().regex(/^[a-zA-Z][\w]{0,39}$/),
  label: z.string().min(1).max(60),
  kind: z.enum(["text", "secret", "number", "checkbox", "select"]).default("text").describe("secret: kept encrypted, never shown again once saved (an API key)."),
  help: z.string().max(300).default(""),
  required: z.boolean().default(false),
  default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  options: z.array(z.string().max(100)).max(50).optional(),
});
const reviewLinkDecl = z.object({
  id: shortId,
  label: z.string().min(1).max(60),
  href: z.string().regex(/^\/(?!\/)[^\s]{0,300}$/).describe("Where the things waiting are (inside Zeff)."),
  count: shortId.describe("The plugin function that gives how many wait (a number)."),
});

const contributes = z.object({
  workerRules: z
    .union([relPath, z.array(relPath).max(10)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .default([])
    .describe("Text files whose content is added to the rules of every Code worker. Needs the prompt permission."),
  workCommands: z.array(command).max(50).default([]).describe('Entries of the Code message box\'s "/" menu.'),
  workerMcpServers: z.record(shortId, z.union([mcpStdio, mcpHttp])).default({}).describe("MCP servers every Code worker gets (stdio: needs exec; http: needs network)."),
  workPanels: z.array(panel).max(20).default([]).describe("Views in Code, shown in a sandboxed frame."),
  apps: z.array(app).max(10).default([]).describe("Entries in Zeff's menu (Apps) that open one of its panels as a page of its own — you can put them in the header (Menu → Customize)."),
  hooks: z.record(eventId, hook).default({}).describe("Programs Zeff runs when something happens. Needs the exec permission."),
  flowActions: z.array(flowActionDecl).max(50).default([]).describe("Actions for flows (the Studio's and the AI's catalog): each is done by one of the plugin's functions. A flow that uses one needs the permission to call that function."),
  fieldTypes: z.array(fieldTypeDecl).max(20).default([]).describe("Field types for the Workspace's databases: an entry is checked (a pattern, a number range or a list of choices) and drawn as text, stars, a bar, a badge or a link. No code needed."),
  schedules: z.array(scheduleDecl).max(10).default([]).describe("Functions run on their own, every so often, for every account the plugin is on in (upkeep, reminders, syncs). They do only what the user granted them."),
  chats: z.array(chatDecl).max(10).default([]).describe("Kinds of live chat with an agent in Zeff: its own rules, tools and a conversation kept in a database (a teacher, a coach, a reviewer)."),
  lookups: z.array(lookupDecl).max(20).default([]).describe("Lookups for views (<lookup>: a film, a book …): a search and a details function of the plugin."),
  sources: z.array(sourceDecl).max(20).default([]).describe("Data sources for the pipelines: a database can follow one; a function of the plugin reads its records."),
  functions: z.array(fnDecl).max(50).default([]).describe("Server functions of its own: code (Python or Node.js) that runs in the Notebook's sessions and is called over HTTP (POST /api/ext/fn/<plugin>/<name>), from Notebook cells (zeff.call) and by other functions."),
  formulaFunctions: z.array(formulaFnDecl).max(30).default([]).describe("Functions for formulas (views, formula fields, tables): each a formula of its own, called by its name like Zeff's own (a name Zeff or another plugin has already is left out)."),
  metrics: z.array(metricDecl).max(20).default([]).describe("Kennzahlen: numbers a plugin function gives, kept and asked again when they are older than everyMinutes."),
  rowBadges: z.array(rowBadgeDecl).max(10).default([]).describe("Badges on the rows its sources brought (by their refs), given by a plugin function."),
  tabMenus: z.array(tabMenuDecl).max(10).default([]).describe("The menu of a tab (its address): entries a plugin function gives."),
  widgets: z.array(widgetDecl).max(20).default([]).describe("Widgets for pages and the dashboard (New block → widget): a list, figures or one figure, given by a plugin function, with buttons that run another."),
  pageNav: z.array(pageNavDecl).max(5).default([]).describe("Entries under its pages in the Workspace tree, given by a plugin function."),
  reviewSources: z.array(reviewSourceDecl).max(10).default([]).describe("Things that wait for your word in the review queue, listed and decided by plugin functions."),
  services: z
    .array(z.object({ name: z.enum(["web.search"]).describe("A service of the kernel (lib/kernel/contract.ts KERNEL_SERVICES)."), lambda: z.string().regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/).max(80).describe("Its lambda (kind function) that answers in the service's shape.") }))
    .max(10)
    .default([])
    .describe("Places of the kernel it fills (web.search …): what Zeff calls stays the same, this plugin answers."),
  lambdas: relPath.optional().describe("A folder of lambdas (<name>/lambda.json and its code, _lib.mjs shared): lookups and functions that run without the Notebook, each in a Node process of its own with only the domains and Zeff calls it names. Their secrets are the plugin's settings they name."),
  tools: z.array(toolDecl).max(30).default([]).describe("Tools for the AI (Zeff's MCP, the Workspace chat, agents), each done by a plugin function — beside Zeff's own."),
  settings: z.array(settingDecl).max(30).default([]).describe("What the user sets for it (Plugins → its Settings): texts, numbers, choices and secrets (kept encrypted). Its functions get them as `inputs.zeffSettings`."),
  reviewLinks: z.array(reviewLinkDecl).max(10).default([]).describe("Things waiting on a page of their own: the review queue shows how many and links there."),
  workspacePackages: z.array(relPath).max(20).default([]).describe("Workspace apps it brings: package files (JSON — a page exported with its databases, widgets, flows), offered under New → templates and made with one click."),
  locales: z
    .record(z.string().regex(/^[a-z]{2}$/, "a language code: de, es …"), relPath)
    .default({})
    .describe('Its texts in other languages: per language code a JSON file { "English text": "translation" } — for its views, blocks, pages and messages (English is the text itself). Zeff\'s own texts win where both have one.'),
  language: z
    .object({
      code: z.string().regex(/^[a-z]{2}$/),
      name: z.string().min(1).max(40).describe("Its name in English (German)."),
      native: z.string().min(1).max(40).describe("Its name in itself (Deutsch)."),
      locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).describe("Dates and numbers: de-DE."),
    })
    .optional()
    .describe("A language pack: the language its locales file for this code makes Zeff speak (Settings → Language offers it while the plugin is installed)."),
});

export const manifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: slug.describe("Also the plugin folder's name."),
    name: z.string().min(1).max(60),
    version: z.string().max(30).default("0.0.0"),
    description: z.string().max(300).default(""),
    author: z.string().max(100).optional(),
    homepage: z.url().optional(),
    repository: z
      .object({
        url: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/, "a GitHub repository: https://github.com/owner/repo"),
        path: z.string().max(200).regex(/^[\w./-]*$/).optional().describe("The plugin's folder in the repository (empty: its top)."),
        branch: z.string().max(100).regex(/^[\w./-]+$/).optional(),
      })
      .optional()
      .describe("Where newer versions of it are: a GitHub repository (one repository may hold many plugins, each in a folder with its own zeff-plugin.json and version). Plugins → Sources checks it and updates on a click."),
    apiVersion: z.number().int().min(1).max(API_VERSION).describe(`The extension API version it was written for (this Zeff speaks up to ${API_VERSION}).`),
    permissions: z.array(permissionId).max(30).default([]).describe("What it may do (granted by you): exec, network, prompt, and the permissions plugins bring (work.read, todos.write, workspace.write …)."),
    contributes: contributes.default({ workerRules: [], workCommands: [], workerMcpServers: {}, workPanels: [], apps: [], hooks: {}, workspacePackages: [], functions: [], flowActions: [], lookups: [], sources: [], fieldTypes: [], chats: [], schedules: [], locales: {}, formulaFunctions: [], metrics: [], rowBadges: [], tabMenus: [], widgets: [], pageNav: [], reviewSources: [], reviewLinks: [], tools: [], settings: [], services: [] }),
  })
  .superRefine((m, ctx) => {
    const has = (p: Permission) => m.permissions.includes(p);
    const need = (p: Permission, path: (string | number)[], what: string) => {
      if (!has(p)) ctx.addIssue({ code: "custom", path, message: `${what} needs the "${p}" permission` });
    };
    if (m.contributes.workerRules.length) need("prompt", ["contributes", "workerRules"], "workerRules");
    if (Object.keys(m.contributes.hooks).length) need("exec", ["contributes", "hooks"], "hooks");
    for (const [name, s] of Object.entries(m.contributes.workerMcpServers)) {
      if ("command" in s) need("exec", ["contributes", "workerMcpServers", name], `The stdio MCP server "${name}"`);
      else need("network", ["contributes", "workerMcpServers", name], `The http MCP server "${name}"`);
    }
    const dup = (list: { id: string }[], key: string) => {
      const seen = new Set<string>();
      list.forEach((x, i) => {
        if (seen.has(x.id)) ctx.addIssue({ code: "custom", path: ["contributes", key, i, "id"], message: `"${x.id}" is used twice` });
        seen.add(x.id);
      });
    };
    dup(m.contributes.workCommands, "workCommands");
    dup(m.contributes.workPanels, "workPanels");
    m.contributes.flowActions.forEach((a, i) => {
      if (!m.contributes.functions.some((f) => f.name === a.function)) ctx.addIssue({ code: "custom", path: ["contributes", "flowActions", i, "function"], message: `no function "${a.function}" in contributes.functions` });
    });
    const hasFn = (n: string) => m.contributes.functions.some((f) => f.name === n);
    m.contributes.lookups.forEach((l, i) => {
      for (const k of ["search", "details"] as const) if (!hasFn(l[k])) ctx.addIssue({ code: "custom", path: ["contributes", "lookups", i, k], message: `no function "${l[k]}" in contributes.functions` });
    });
    m.contributes.widgets.forEach((w, i) => {
      if (!w.function === !w.lambda) ctx.addIssue({ code: "custom", path: ["contributes", "widgets", i], message: "a widget names a function or a lambda (one of them)" });
      else if (w.lambda && !m.contributes.lambdas) ctx.addIssue({ code: "custom", path: ["contributes", "widgets", i, "lambda"], message: "a widget's lambda needs contributes.lambdas" });
    });
    m.contributes.tools.forEach((x, i) => {
      if (!x.function === !x.lambda) ctx.addIssue({ code: "custom", path: ["contributes", "tools", i], message: "a tool names a function or a lambda (one of them)" });
      else if (x.function && !hasFn(x.function)) ctx.addIssue({ code: "custom", path: ["contributes", "tools", i, "function"], message: `no function "${x.function}" in contributes.functions` });
      else if (x.lambda && !m.contributes.lambdas) ctx.addIssue({ code: "custom", path: ["contributes", "tools", i, "lambda"], message: "a tool's lambda needs contributes.lambdas (the folder of its lambdas)" });
    });
    m.contributes.sources.forEach((s, i) => {
      if (!hasFn(s.read)) ctx.addIssue({ code: "custom", path: ["contributes", "sources", i, "read"], message: `no function "${s.read}" in contributes.functions` });
    });
    m.contributes.fieldTypes.forEach((f, i) => {
      if (f.pattern) {
        try {
          new RegExp(f.pattern);
        } catch {
          ctx.addIssue({ code: "custom", path: ["contributes", "fieldTypes", i, "pattern"], message: "not a valid regular expression" });
        }
      }
      if (f.kind === "choice" && !f.options.length) ctx.addIssue({ code: "custom", path: ["contributes", "fieldTypes", i, "options"], message: "a choice needs options" });
    });
    m.contributes.chats.forEach((c, i) => {
      if (c.context && !hasFn(c.context)) ctx.addIssue({ code: "custom", path: ["contributes", "chats", i, "context"], message: `no function "${c.context}" in contributes.functions` });
      (c.conversation?.watch ?? []).forEach((w, j) => {
        if (!hasFn(w.function)) ctx.addIssue({ code: "custom", path: ["contributes", "chats", i, "conversation", "watch", j, "function"], message: `no function "${w.function}" in contributes.functions` });
      });
    });
    m.contributes.schedules.forEach((s, i) => {
      if (!hasFn(s.function)) ctx.addIssue({ code: "custom", path: ["contributes", "schedules", i, "function"], message: `no function "${s.function}" in contributes.functions` });
    });
    dup(m.contributes.schedules, "schedules");
    dup(m.contributes.chats, "chats");
    dup(m.contributes.fieldTypes, "fieldTypes");
    dup(m.contributes.lookups, "lookups");
    dup(m.contributes.sources, "sources");
    {
      const seenFn = new Set<string>();
      m.contributes.functions.forEach((f, i) => {
        if (seenFn.has(f.name)) ctx.addIssue({ code: "custom", path: ["contributes", "functions", i, "name"], message: `"${f.name}" is used twice` });
        seenFn.add(f.name);
      });
    }
    m.contributes.apps.forEach((a, i) => {
      if (!m.contributes.workPanels.some((p) => p.id === a.panel)) ctx.addIssue({ code: "custom", path: ["contributes", "apps", i, "panel"], message: `no panel "${a.panel}" in workPanels` });
    });
  });

export type Manifest = z.output<typeof manifestSchema>;
export type McpServerDecl = Manifest["contributes"]["workerMcpServers"][string];

/** A manifest as text (JSON) → the manifest, or what's wrong with it, in plain sentences. */
export function parseManifest(text: string): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `zeff-plugin.json isn't valid JSON: ${(e as Error).message}` };
  }
  const r = manifestSchema.safeParse(raw);
  if (r.success) return { ok: true, manifest: r.data };
  return {
    ok: false,
    error: r.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.length ? i.path.join(".") : "(manifest)"}: ${i.message}`)
      .join("; "),
  };
}
