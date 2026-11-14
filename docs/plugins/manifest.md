# The manifest: `zeff-plugin.json`

Every plugin folder has one. Zeff checks it when it looks at the plugins folder; what's wrong with it is shown
on the Plugins page (*Not loaded: …*). A manifest is JSON (a BOM is fine). The machine-readable definition is
[`zeff-plugin.schema.json`](zeff-plugin.schema.json), generated from the code that validates it
(`npm run plugin:schema`).

```json
{
  "$schema": "http://127.0.0.1:9333/ext/sdk/zeff-plugin.schema.json",
  "id": "run-dashboard",
  "name": "Run dashboard",
  "version": "1.0.0",
  "description": "Recent runs at a glance",
  "author": "You",
  "homepage": "https://example.com",
  "apiVersion": 1,
  "permissions": ["work.read", "work.write", "prompt"],
  "contributes": { }
}
```

## Top-level fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | `a`–`z`, digits and `-`, starting with a letter, 2–40 characters. **Also the folder's name** (`plugins/<id>/`). Not `sdk`, `docs`, `view` or `raw` (Zeff's own paths). |
| `name` | string | yes | What the Plugins page shows, up to 60 characters. |
| `apiVersion` | integer | yes | The extension API version the plugin was written for. This Zeff speaks **1**. A higher number is refused. |
| `version` | string | no | Free text (`1.2.0`), shown on the Plugins page. Default `0.0.0`. |
| `description` | string | no | One or two sentences, up to 300 characters. |
| `author`, `homepage` | string | no | Shown / informational. `homepage` must be a URL. |
| `repository` | object | no | Where newer versions are: `{ "url": "https://github.com/owner/repo", "path": "apps/notes", "branch": "main" }` — a GitHub repository, the plugin's folder in it (empty: its top), the branch (default: the repository's). Plugins → *Sources* then checks it and updates on a click. |
| `permissions` | string[] | no | What the plugin may do, see below. Default none. |
| `contributes` | object | no | What it adds, see below. |
| `$schema` | string | no | For editors. Ignored by Zeff. |

Unknown fields are ignored.

## Versions and updates from GitHub

One GitHub repository can hold many plugins and apps — each in a folder with its own `zeff-plugin.json`, whose `version` (semver,
`1.4.2`) is the one that counts:

```
zeff-apps/
  apps/notes/zeff-plugin.json      { "id": "notes", "version": "1.1.0", … }
  apps/notes/app.json              (its Workspace app: contributes.workspacePackages)
  tools/calc/zeff-plugin.json      { "id": "calc", "version": "2.0.0", … }
```

In Zeff, **Plugins → Sources → Add a repository** (a private one with a token you enter there). Zeff reads the repository's tree and
every manifest in it (up to four folders deep), shows each plugin with the version there against the one installed, and offers
**Install** or **Update to x.y.z** (and *Update all*). A click fetches exactly that folder at the commit it read and writes it into the
plugins folder (the folder is named by the `id`). What happens then:

- A plugin installed from a source starts **switched off**; permissions an update adds are held back until you switch it on again.
- A function you (or the AI) changed in Zeff — its versions are in `.versions/` — **stays as you made it**; files the new version no
  longer has go (only files the source brought).
- Its Workspace app, when installed, is **updated in place** the usual way (what you changed there stays; a save point is kept first).
- Zeff remembers where each came from (repository, folder, branch, commit). A plugin can also name its repository itself (`repository`
  above): it then shows up under Sources without being added. Nothing is checked or updated by itself — *Check now* reads again (the
  answer is kept ten minutes).

To publish a new version: change the folder, raise `version` in its `zeff-plugin.json`, push. (`Save as plugin` on a page writes such a
folder — commit it into your repository.)

## Permissions

You grant them when you turn the plugin on (the confirmation lists them). A permission the manifest doesn't name
is never granted, and a method or contribution that needs one fails or is skipped without it.

| Permission | Allows | Needed by |
| --- | --- | --- |
| `work.read` | Read Work sessions, their logs and results | `work.runs.list`, `work.runs.get`, `work.runs.log` |
| `work.write` | Start, continue and stop Work sessions | `work.sessions.start`, `work.sessions.send`, `work.runs.cancel` |
| `todos.read` | Read your todos | `todos.list` |
| `todos.write` | Add todos | `todos.add` |
| `llm.read` | Read the instructions and numbers of the AI steps | `llm.steps.list` |
| `llm.write` | Change the instructions and numbers of the AI steps | `llm.steps.update` |
| `timeline.read` | Read the timeline: what happened with people, tickets, pages and projects | `timeline.for`, `timeline.since` |
| `workspace.write` | Add and change pages and rows of the Workspace | `workspace.rows.add`, `workspace.rows.update`, `workspace.pages.create`, `workspace.pages.append` |
| `calendar.read` | Read your appointments | `calendar.events` |
| `calendar.write` | Add and remove appointments in Zeff's own calendars | `calendar.event.add`, `calendar.event.delete` |
| `prompt` | Add rules to what Work's workers are told | `contributes.workerRules` |
| `exec` | Run programs on this computer — **with your rights** | `contributes.hooks`, stdio entries of `contributes.workerMcpServers` |
| `network` | Let the plugin's panels contact other websites; allow http MCP servers | http entries of `contributes.workerMcpServers` |

The storage methods (`storage.*`) and `hello` need no permission. The manifest is **rejected** when a
contribution needs a permission it doesn't declare (for example `hooks` without `exec`).

## `contributes`

All parts are optional.

### `workerRules`

A path, or a list of up to ten paths, of text files **inside the plugin folder** (relative, no `..`). Their
content is added — under a heading naming the plugin — to the rules of **every** Work worker (Claude one-shot and
live sessions, Codex, Copilot), up to 8000 characters per file. Needs `prompt`. Read when a worker starts, so an
edit counts for the next run.

```json
"workerRules": ["rules.md", "rules/testing.md"]
```

### `workCommands`

Entries of the message box's `/` menu. Picking one puts its `template` into the box — you can edit it before
sending.

| Field | Meaning |
| --- | --- |
| `id` | `a`–`z`, digits, `-` (unique in the plugin) |
| `label` | What the menu shows after the `/` (up to 40 characters) |
| `description` | A line under it (optional, up to 200) |
| `template` | The text (up to 8000 characters, line breaks allowed) |

```json
"workCommands": [
  { "id": "review", "label": "review", "description": "Review this branch", "template": "Review the changes on this branch. Don't change code." }
]
```

### `workPanels`

Views of your own, shown in a sandboxed frame (see [panels](panels.md)).

| Field | Meaning |
| --- | --- |
| `id` | unique in the plugin |
| `title` | up to 40 characters |
| `entry` | the HTML page, **relative to the plugin's `ui/` folder** |
| `placement` | `"tab"` (default): a link in Work's sidebar opening a page of its own. `"session"`: an extra tab next to *Conversation / Changes / Preview* of every session; the panel is told which session. |

### `apps`

Entries in Zeff's menu (*Apps*) that open one of the plugin's panels as a page of its own — not tied to Work.
Each names a panel declared in `workPanels` (any `placement`); you can move the entry into the header with
*Menu → Customize*, like a built-in app's.

| Field | Meaning |
| --- | --- |
| `panel` | the `id` of a panel in `workPanels` |
| `label` | its name in the menu (up to 30 characters) |
| `short` | its name in the header (up to 12) |
| `hint` | a line under the name (optional, up to 80) |

```json
"workPanels": [{ "id": "board", "title": "Team board", "entry": "board.html" }],
"apps": [{ "panel": "board", "label": "Team board", "short": "Team", "hint": "Who works on what" }]
```

### `workerMcpServers`

MCP servers every worker gets, by name. The worker sees them as `ext-<plugin id>-<name>`. Two shapes:

```json
"workerMcpServers": {
  "tools": { "command": "node", "args": ["./server.mjs"], "env": { "MODE": "fast" } },
  "remote": { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }
}
```

- **stdio** (`command`, `args`, `env`) needs `exec`. `"node"` means the Node that runs Zeff (it is always there,
  also in the packaged app, where there is no Node on the PATH). An argument or command starting with `./` is
  relative to the plugin folder. The process gets `ZEFF_API_URL`, `ZEFF_EXT_ID`, `ZEFF_EXT_TOKEN`, `ZEFF_ACCOUNT`
  so it can call the [API](api.md).
- **http** (`url`, `headers`) needs `network`.

They reach Claude workers (one-shot and live sessions). Codex and Copilot workers don't get them yet.

### `hooks`

Programs to run when an event happens, by event name. Needs `exec`.

```json
"hooks": {
  "work.run.finished": { "command": ["node", "./on-finished.mjs"], "timeoutMs": 5000 }
}
```

`command` is the program and its arguments (no shell); `timeoutMs` is 200–30000 (default 5000). The events and
what a hook receives are in [hooks](hooks.md).

### `workspacePackages`

Workspace apps the plugin brings: package files (JSON, relative to the plugin folder) — a page with its sub-pages,
databases (and their rows, if exported with them), widgets, flows and the values its widgets share. While the plugin
is on, each is offered under **New → templates** in the Workspace and made with one click. No permission needed: what
an app's widgets and flows may do is asked of whoever installs it.

```json
"workspacePackages": ["app.json"]
```

The easiest way to make one: open the page in the Workspace, **⋯ → Save as plugin** — Zeff writes the folder
(`app-<name>/zeff-plugin.json` and `app.json`) into the plugins folder; saved again, its version goes one up. Copy
the folder to hand the app on.

### `locales`

The plugin's texts in other languages — per language code a JSON file (relative to the plugin folder) mapping the English text to
its translation, like Zeff's own bundles. They count for everything the plugin draws through Zeff: its views, blocks and pages
(the view language translates their words) and its packages' page titles. (Texts a function returns are not translated yet — a
`zeff.t()` in functions is still to come.)
English needs no file — it is the text itself. Where Zeff's own bundle has the same text, Zeff's translation wins.

```json
"locales": { "de": "i18n/de.json", "es": "i18n/es.json" }
```

On the server the files are read from the plugins folder (again when one changes); the browser gets them as one script per language
(`/api/i18n/<lang>?v=<version>`, cached until a text changes). A plugin that used to be built in takes its texts out of Zeff's bundles
with `npx tsx scripts/i18n-extract-plugin.mts <plugin folder>` (the ones Zeff itself still uses stay there too).

### `language`

A language pack: the language its `locales` file for that code makes Zeff speak. Settings → Language offers it while the plugin is
installed.

```json
"language": { "code": "es", "name": "Spanish", "native": "Español", "locale": "es-ES" },
"locales": { "es": "es.json" }
```

Zeff's own German and Spanish are such packs (zeff-plugins: `plugins/lang-de`, `plugins/lang-es`); without them Zeff speaks
English. Today the codes Zeff can speak are en, de and es. A pack's texts come before every other plugin's own.

## Rules the validator applies

- the folder is named like `id`; ids are unique among plugins
- `workerRules`, `entry` and all other paths stay inside the plugin folder
- command and panel ids are unique within the plugin
- a contribution needs its permission: `workerRules` → `prompt`; `hooks` → `exec`; a stdio MCP server → `exec`;
  an http MCP server → `network`
- only known permissions and events

## Checking a manifest

In a checkout: `npm run plugin:check -- path/to/plugin` validates the manifest and that the files it names exist
(rules, panel pages, hook and server scripts). In the app, the Plugins page shows the same errors.

## `contributes.functions` — server functions of your own

A plugin can bring **functions**: code (Python or Node.js) that runs in the [Notebook](../extensions/notebook.md)'s sessions — in a Docker
container by default — and is called by name. This is a plugin's own server side.

```json
"contributes": {
  "functions": [{
    "name": "summarize",
    "title": "Summarize a text",
    "runtime": "python",
    "file": "fn/summarize.py",
    "input": { "text": "the text to summarize" },
    "needs": ["metrics", "write:outputs"],
    "timeoutSeconds": 60
  }]
}
```

- **The code** gets its arguments as `inputs["text"]` (and as variables) and gives back what it **returns** — its last expression, or a
  top-level `return` — as JSON. It has the whole `zeff.*` of a Notebook cell (`zeff.metrics()`, `zeff.meta.…`, `zeff.call(plugin, name, **args)`).
- **`needs`** lists what of Zeff it reads or changes (the Notebook's permission keys: `metrics`, `outputs`, `databases`, `database:<id>`,
  `write:outputs`, `write:database:<id>`, `delete:database:<id>`, `meta:…`, `call:<plugin>.<name>`). There is nobody to ask when a function runs
  (an HTTP call, a job), so the user allows them **in advance**: *Settings → Notebook → Functions → Allow what they need*. What is not
  allowed is refused. A function has no page, so it reads no page tables.
- **Called** over HTTP — `POST /api/ext/fn/<plugin>/<name>` with the arguments as a JSON object (the plugin's own programs send
  `Authorization: Bearer $ZEFF_EXT_TOKEN`; Zeff's own pages call it same-origin) — answering `{ "ok": true, "result": …, "log": "…" }` — and
  from Notebook cells with `zeff.call("my-plugin", "summarize", text=…)` (a permission of its own, `call:<plugin>.<name>`). Functions
  calling functions go at most 4 deep.
- Also called **from widgets** (`zeff.fn.call("my-plugin", "summarize", { text })` — the widget asks, you allow that function for its code, like
  any permission of a widget), **from flows** (the action `fn.call`; the flow's permissions, *Zeff's structure → Functions it may call*) and
  **by agents** over MCP (`workspace_functions`, `workspace_call_function`) — in every case the function only does what it was granted.
- A function of a plugin that brings its own **package** names that package's databases by their place in it: `"needs": ["database:@my-pkg.i2", "write:database:@my-pkg.i2"]` (the package's `id` and the item's number). Once the package is installed, *Allow what they need* grants them for the database it made.
- Needs the Notebook plugin installed and *Let code blocks run* switched on; the plugin must be on in the account.

## `contributes.workspacePackages` — apps that live

Each file is a package (JSON). With an `id` and a `version` the install is remembered and a newer version of the same `id` — shipped in a
newer version of your plugin — updates the installed pages **in place**, migrating data by the `migrations` you declare, checking
`requires` / `plugins`, running your `tests`, and keeping what the user changed. The format and an example are in
[Packages that live](../extensions/workspace.md).

## `contributes.flowActions` — actions for flows

A plugin can bring **actions for flows** — blocks of the Studio's catalog (and of the AI's, when it builds a flow) — each done by one of its
`functions`:

```json
"flowActions": [{
  "name": "summarize", "label": "Summarize a text", "summary": "Boils a text down to a few sentences.",
  "function": "summarize",
  "input": [{ "name": "text", "type": "text", "required": true }],
  "output": "{ summary }",
  "writes": false
}]
```

The action is called `<plugin id>.<name>` (`my-plugin.summarize`). Its input is the function's arguments, its output the function's result.
A flow that uses it needs the permission to call that function (*Zeff's structure → Functions it may call: `my-plugin.summarize`*); the
function itself only does what it was granted in Settings → Notebook → Functions. `writes: true`: a dry run does not call it.

## `contributes.lookups` and `contributes.sources` — search and data, done by functions

A plugin can bring a **lookup** (what a view's `<lookup>` searches: a film, a book, a bird) and a **data source** (records a database can
follow, which filters, joins and views then work on) — each read by one of its `functions`:

```json
"lookups": [{ "id": "birds", "label": "Birds", "what": "Finds birds by name.",
  "fields": { "title": "name", "wings": "wing span in cm" },
  "search": "find", "details": "one" }],
"sources": [{ "id": "birds", "label": "Birds", "hint": "The birds in my notebook", "read": "all" }]
```

- Lookup `search` gets `{ query, language }` and returns `[{ id, title, subtitle?, image? }]`; `details` gets `{ id, language }` and returns
  the fields by name. The lookup is called `<plugin id>.<id>`.
- Source `read` returns `[{ ref, title, key?, fields?, text?, url?, updatedAt? }]` (`ref` identifies the record). Its id is `<plugin id>.<id>`;
  by default its records are read-only (`noNewRows`).
- The functions only do what the user granted them (Settings → Notebook → Functions). Both appear only while the plugin is on.

## Webhooks — a function called from outside

A function with `"webhook": true` can be called by a program outside Zeff: `POST /api/ext/hook/<plugin>/<name>` (add `?account=<id>` for
another account). You switch this on yourself in *Settings → Notebook → Functions of plugins* — that makes a **secret** for the plugin; the
caller sends it as `Authorization: Bearer <secret>`. Without a secret nobody can call; *Make a new secret* ends the old one. The body is the
function's arguments (JSON; any other body arrives as `{ "body": "…" }`). The function does only what it was granted, like any call.
(Zeff listens on this computer only; to reach it from the internet you need a tunnel of your own.)

## `contributes.fieldTypes` — field types without code

A plugin can add **field types** to the Workspace's databases (a ticket key, a country, a score). No function is needed: an entry is checked
by what the type says and drawn the way it says.

```json
"fieldTypes": [
  { "id": "ticket", "label": "Ticket", "kind": "text", "pattern": "^[A-Z]+-\\d+$", "display": "link", "href": "https://tracker.example/{value}" },
  { "id": "score", "label": "Score", "kind": "number", "min": 0, "maxValue": 10, "display": "progress" },
  { "id": "mood", "label": "Mood", "kind": "choice", "options": ["good", "ok", "bad"], "display": "badge" }
]
```

`kind`: `text` (any text, optionally matching `pattern`), `number` (between `min` and `maxValue`) or `choice` (one of `options`, offered while
typing). `display`: `text`, `rating` (stars, up to `max`), `progress` (a bar, 0–100), `badge` or `link`. Its id is `<plugin id>.<id>`.

Functions can also use Zeff's plugin methods (`"needs": ["api:todos.add", "api:calendar.event.add"]`, `zeff.api(…)` in the code) and the AI (`"needs": ["ai"]`, `zeff.ai(…)`); a package's databases are named `@my-pkg.i3` in `needs`, in code, in flows (`db.query`) — see [Packages that live](../extensions/workspace.md).

A complete example that uses most of this: [src/plugins/learn/bundled](../../src/plugins/learn/bundled) — Zeff's Learn as an external plugin.

## `contributes.chats` — a live agent of your own

A plugin can bring a **kind of chat**: a live Claude session in Zeff (like the chat, or Work) with rules, tools and a conversation of its
own — a teacher, a coach, a reviewer. The rules are a text file of the plugin; `{{name}}` places in it are filled by one of its functions
(the *context*, called with `{ key }` each time a session starts, so the rules always say how things stand now). The agent works only
inside Zeff, like every chat; its tools are the chat's own plus the Zeff MCP tools you list — `workspace_call_function` calls the plugin's
functions, which do what the user granted them.

```json
"chats": [{
  "id": "lesson", "rules": "teacher.md", "context": "lesson-context",
  "tools": ["workspace_call_function", "workspace_functions"],
  "conversation": { "database": "@my-pkg.i9", "text": "Text", "role": "Role", "key": "Step", "kind": "Kind", "run": "Run", "order": "Order", "at": "At",
                    "watch": { "exercise": "exercise", "mastered": "master" } }
}]
```

- A chat is one conversation **per key** (a step, a ticket, a customer). The view tag `<chat chat="my-plugin.lesson" key="{{ state.step }}"/>`
  shows the box: *Begin* the first time, the live session while the agent speaks, the message box otherwise.
- `conversation` keeps the conversation in a **database you can edit**, one row per message (yours, the agent's, an exercise made, a step
  mastered — `watch` names the plugin functions whose calls are messages of their own). The view shows the conversation from there. What you
  change or delete in the database is what the chat goes on with: the next message starts a fresh session with the stored conversation.

## `contributes.formulaFunctions`, `metrics`, `rowBadges`, `tabMenus` — extension points without TypeScript

What Zeff's own plugins bring to these extension points in TypeScript, a plugin declares here ([the kernel contract](../kernel-contract.md)).
They are there while the plugin is on, gone when it is off or Zeff is in safe mode, and changed when the plugin changes, with no restart.

```json
"formulaFunctions": [
  { "name": "withVat", "args": ["net", "rate"], "value": "prop(\"net\") * (1 + prop(\"rate\") / 100)", "what": "A price with VAT.", "unit": "€" }
],
"metrics": [
  { "id": "watched", "label": "Films watched", "unit": "films", "function": "count", "everyMinutes": 15 }
],
"rowBadges": [
  { "prefix": "film:", "function": "badges" }
],
"tabMenus": [
  { "tab": "/films", "function": "menu" }
]
```

- **`formulaFunctions`**: a formula of its own, no code and nothing it can change. Its arguments are read in `value` as `prop("name")`.
  It is called like Zeff's own functions, `withVat(100, 19)`, in views, formula fields and tables. A name the formula language already
  has, its other names included (`wenn`, `gross` …), is left out.
- **`metrics`**: a Kennzahl (`kennzahl("Films watched")` in formulas, the Kennzahlen widgets). The function is called with `{}` and gives
  a number. The Kennzahl shows its last answer and asks again in the background once that is older than `everyMinutes` (1–1440, default
  15), so a formula never waits for it.
- **`rowBadges`**: badges on the rows a plugin's source brought, by their record's ref. The function gives
  `{ "film:12": [{ "label": "2 new", "tone": "unread", "count": 2 }] }`. Only refs starting with `prefix` count. `tone` is `important`,
  `unread`, `activity` (default) or `messages`.
- **`tabMenus`**: the menu of a tab, by its address. The function gives `[{ "href": "/films/1", "label": "Alien", "hint": "1979" }]`.
  Only addresses inside Zeff count.

The functions are the plugin's own (`contributes.functions`) and do only what you granted them.

## `contributes.widgets`, `pageNav`, `reviewSources`, `reviewLinks` — more extension points from functions

```json
"widgets": [
  { "id": "latest", "label": "Latest films", "icon": "🎬", "size": "half", "ttl": 60, "function": "latest", "act": "press",
    "settings": [{ "key": "max", "label": "How many", "kind": "number", "default": 5, "min": 1, "max": 20 }] }
],
"pageNav": [{ "function": "places" }],
"reviewSources": [{ "id": "ratings", "label": "Ratings to confirm", "list": "ratings", "act": "rate" }],
"reviewLinks": [{ "id": "inbox", "label": "New films", "href": "/films/inbox", "count": "inbox-count" }]
```

- **`widgets`**: a widget for pages and the dashboard, among Zeff's own (New block → widget), with the id `<plugin id>.<id>`. `function`
  is called with `{ config }` (the settings as set) and gives one of:
  - `{ "kind": "list", "items": [{ "id", "text", "detail"?, "icon"?, "meta"?, "badge"?, "href"?, "tone"?, "done"?, "actions"?: [{ "id", "label" }] }], "title"?, "count"?, "empty"?, "footer"?: { "text", "href" } }`;
  - `{ "kind": "stats", "tiles": [{ "label", "value", "detail"?, "tone"?, "href"?, "bar"?: { "value", "max" } }] }`;
  - `{ "kind": "figure", "value", "caption", "detail"?, "href"? }`.

  `tone` is `good`, `warn` or `bad`. Links go inside Zeff or to a web address. A button runs `act` with `{ action, payload, config }`.
  What it gives (data as above) is shown; otherwise the data is read again. The data is kept for `ttl` seconds (default 60). Anything
  else the function gives shows as an error line in the widget.
- **`pageNav`**: entries under pages in the Workspace tree. The function gives
  `[{ "pageId": 12, "entries": [{ "id", "label", "icon"?, "n"?, "group"?, "href"? }] }]`, with the page ids of its own pages (its package's). An entry without `href` opens the page with
  `?nav=<id>`.
- **`reviewSources`**: things that wait for your word in the review queue, under `label`. `list` gives
  `[{ "id", "title", "detail"?, "confidence"?, "href"?, "actions": [{ "id", "label", "primary"? }] }]`. An entry without buttons isn't
  shown. A button runs `act` with
  `{ item, action }`, and what it gives (a text) is said.
- **`reviewLinks`**: things waiting on a page of their own. The queue shows how many (`count` gives a number) and links to `href` (inside
  Zeff).

## `contributes.tools` and `contributes.settings` — tools for the AI, settings with secrets

```json
"tools": [
  { "name": "film_find", "title": "Find a film", "description": "Find a film by its title — use it when …", "function": "find",
    "input": [{ "name": "title", "type": "text", "description": "Its title", "required": true }, { "name": "year", "type": "number" }],
    "readOnly": true }
],
"settings": [
  { "key": "apiKey", "label": "API key", "kind": "secret", "required": true, "help": "From your account at …" },
  { "key": "language", "label": "Language", "kind": "select", "options": ["de", "en"], "default": "en" }
]
```

- **`tools`**: each one is a function of the plugin that the AI calls by `name`. It shows beside Zeff's own tools in Zeff's MCP, the
  Workspace chat and agents. `input` types: `text`, `number`, `boolean`, `json`, `list`. The function gets the arguments, and what it
  returns is the answer (text as it is, anything else as JSON). A name Zeff or another plugin already has is left out: Zeff's own come
  first. The tool is there only while the plugin is on, so safe mode has none. `readOnly` marks a tool that only reads.
- **`settings`**: what the user sets on the plugin's card on the Plugins page (⚙️ Settings). Kinds: `text`, `number`, `checkbox`,
  `select` (with `options`) and `secret`.
  - A secret is kept encrypted (AES-256-GCM, with a key file beside the data, never in the database) and never shown again: the form
    says only that one is set, and leaving it empty keeps it.
  - The plugin's own functions get every value as `inputs.zeffSettings` (secrets in clear). No other plugin sees them, and they are not
    kept with the run.
  - `required` settings not set yet show as *needs setting up* on the card.

## `contributes.lambdas` — code that runs without the Notebook

```json
"lambdas": "lambdas",
"tools": [{ "name": "film_find", "description": "…", "lambda": "films.find", "input": [{ "name": "title", "type": "text", "required": true }] }]
```

A folder of lambdas: `<name>/lambda.json` with its code (`index.mjs`, exporting `handler`), and `_lib.mjs` beside them, which each
lambda gets as its `lib.mjs`. These are the same as the Studio's lambdas: lookups (`kind: "lookup"`) and functions
(`kind: "function"`).

- **The sandbox.** Each lambda runs in a Node process of its own. It may read only its folder, it may reach only the domains its
  `lambda.json` names (never a private address), and it may call only the Zeff functions it names. There is a memory and a time limit.
  No Notebook or Docker is needed.
- **Secrets.** Its secrets (`"secrets": ["TMDB_KEY"]`) come from the plugin's settings of that key, and from the Studio's secrets.
  Only its own plugin's settings are used, and only the keys it names.
- **Your changes.** A change you make to one in the Studio wins over the plugin's until you reset it.
- **Tools.** A tool can name a lambda (kind `function`) instead of a function: `"lambda": "<name>"`.

Lookups is built this way ([zeff-plugins/plugins/lookups-ext](../../../zeff-plugins/plugins/lookups-ext)).

## `contributes.services` — filling a place of the kernel

```json
"services": [{ "name": "web.search", "lambda": "web.search.run" }]
```

Some things the rest of Zeff calls have a fixed shape in the kernel: a **service** (`KERNEL_SERVICES` in `src/lib/kernel/contract.ts`).
A plugin fills one with a lambda of its own (kind `function`). Everything that calls the service keeps calling it the same way,
whichever plugin answers: a built-in, or a port of it. The answer is checked against the shape.

| Service | Called with | Answers |
| --- | --- | --- |
| `web.search` | `{ query, count?, site?, language? }` | `{ hits: [{ title, url, snippet }] }` (only http(s) addresses) |

`web.search` is used by flows, by the lookups' web source and by Learn's research. While the built-in Web search is installed, it
answers; otherwise the first plugin that is on and fills the service does.

Lambdas also reach the kernel's own actions (name them in `lambda.json`'s `"zeff"`). These include `web.read` (a page as text, never
the machine's own network) and `ai.websearch` (a search through the Claude login, no key needed).

### The `browser` permission

`"permissions": ["browser"]` lets the plugin's lambdas open public pages in Zeff's automated Chrome
(`context.zeff.call("web.browse", { url, steps?, maxChars? })`, with `"zeff": ["web.browse"]` in `lambda.json`). The Chrome is a driver
of the kernel
(`src/lib/web/browser.ts`): an empty profile, no logins, and never the machine's own network, also for what a page loads. You grant the
permission when you switch the plugin on. The address must be one the lambda's `"web"` allows. The answer is
`{ url, status, title, text, truncated, mainImage, images: [{ src, alt, width, height }], links: [{ href, text }] }`.

### Porting a built-in's pure code

Code of a built-in that reads nothing of Zeff (computing, wording) doesn't have to be written twice. Pull it into a pure module whose
translator and data come as arguments (Correlations: `src/plugins/correlations/core.ts`), let the built-in use it, and bundle it into
the port's lambdas with esbuild (`scripts/port-correlations.mts` writes `lambdas/_lib.mjs`, with the German and Spanish texts it says).
The built-in and its port then say the same, word for word. A lambda knows the user's language as `context.language`; data comes
through the kernel's reads (`series.read`, `series.catalog`, `web.read` …).

Widgets can name a lambda too (`"lambda"` and `"actLambda"` instead of `"function"` and `"act"`). A select setting can take its options
from Zeff (`"optionsFrom": "series"`). A port's widget takes over the id of the built-in it replaces (`"replaces": "correlations.findings"`),
so the widgets on your pages keep working after the switch.

## `contributes.compute` and `appViews` — screens without React

```json
"compute": "compute.js",
"appViews": [{ "id": "mail", "dataType": "mail", "label": "Mail", "icon": "✉", "template": "views/mail.html" }]
```

- **`appViews`**: a screen for the databases of a type (mails, messages, the combined inbox …). Each is a template of the view
  language in a file of the plugin. Zeff gives a new database of that type this screen as its first view, and offers it in the
  database's View menu. Its words are shown in the user's language where Zeff's bundles know them.
- **`compute`**: a script of pure functions a view runs in the browser: `<data name="app" compute="my-plugin.fn"/>`. The function is
  called with `{ rows, props, state, extras, with, now }` and its answer is `data.app`. It runs again at once whenever one of those
  changes, as fast as the built-in views' own code. The script runs in a sandboxed frame of its own: an opaque origin, no network, no
  access to Zeff. It sees only what the view hands it. It must define `ZeffCompute` with the functions (esbuild:
  `format: "iife", globalName: "ZeffCompute"`).
- **Doing things.** A view's button does one of the kernel's actions as you: `<button do="row.op" with='…' confirm="…"/>`, with
  `fill="state=field"` (fields of the answer into the view's state), `into=`, `done=`, `then="a=1; b="`. A `<data do="…">` does one by
  itself, but only those that read or mark read (`AUTO_ACTIONS` in `src/plugins/workspace/flows/mail-actions.ts`); `reload=true` reads
  the rows again after it. Which actions a button may do is fixed by the kernel (`USER_ACTIONS`): a conversation read, a reply drafted
  by the AI, a row's action (a reply sent, kept as a draft or opened in Outlook), mails archived or marked read, a field set on rows,
  Gmail's archive and unread, a new inbox.
- **Text inputs** keep what you type per row when their state's name holds the row (`bind="reply{{ data.app.current.id }}"`).
  `enter="event"` sends an event on Enter (a chat line), `rows=` sets a text area's height.

Mail & Chat is built this way ([zeff-plugins/plugins/mail-client-ext](../../../zeff-plugins/plugins/mail-client-ext)): its compute
script is the built-in's `view-data.ts`, bundled by `scripts/port-mail-client.mts`, and its screens are the built-in's templates
turned into view language (`src/plugins/mail-client/port.meta.ts`).
