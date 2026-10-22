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
| `kanban.read` | Read your Kanban boards and cards | `kanban.boards.list`, `kanban.boards.get` |
| `kanban.write` | Add, change, move and archive Kanban cards | `kanban.cards.add`, `kanban.cards.update`, `kanban.cards.move`, `kanban.cards.archive`, `kanban.cards.unarchive` |
| `timeline.read` | Read the timeline: what happened with people, tickets, pages and projects | `timeline.for`, `timeline.since` |
| `workspace.write` | Add and change pages and rows of the Workspace | `workspace.rows.add`, `workspace.rows.update`, `workspace.pages.create`, `workspace.pages.append` |
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
