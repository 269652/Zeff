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
| `permissions` | string[] | no | What the plugin may do, see below. Default none. |
| `contributes` | object | no | What it adds, see below. |
| `$schema` | string | no | For editors. Ignored by Zeff. |

Unknown fields are ignored.

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
