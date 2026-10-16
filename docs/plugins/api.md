# The extension API (version 1)

What a plugin's **panel** or **program** (a hook, an MCP server) can ask of Zeff. One HTTP endpoint, JSON in and
out, a permission per method. A panel doesn't call HTTP itself — it uses `window.zeff` ([panels](panels.md)) —
but the methods and results are the same.

## Calling it

```
POST /api/ext/v1/<method>
Content-Type: application/json
Authorization: Bearer <ZEFF_EXT_TOKEN>

{ "limit": 5 }
```

The body is the method's parameters, a JSON object (empty or missing: none). The answer:

```json
{ "ok": true, "result": [ … ] }
{ "ok": false, "error": { "code": "permission", "message": "todos.list needs the \"todos.read\" permission …" } }
```

| `error.code` | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | No token, or one Zeff didn't make |
| `permission` | 403 | The plugin is off in this account, or lacks the method's permission |
| `bad_request` | 400 | A parameter is missing or has the wrong type; unknown account |
| `not_found` | 404 | No such method, run … |
| `failed` | 400 / 500 | The action itself failed (its message says why) |

### Who is calling

- **A program the plugin started** (a hook, a stdio MCP server) has the environment variables
  `ZEFF_API_URL` (like `http://127.0.0.1:9333`), `ZEFF_EXT_TOKEN`, `ZEFF_EXT_ID`, `ZEFF_ACCOUNT`:

  ```js
  const r = await fetch(`${process.env.ZEFF_API_URL}/api/ext/v1/todos.add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ZEFF_EXT_TOKEN}`, "x-zeff-account": process.env.ZEFF_ACCOUNT },
    body: JSON.stringify({ text: "Look at the failed run", ticket: "ABC-12" }),
  });
  const { ok, result, error } = await r.json();
  ```

- **A panel** calls `zeff.call("todos.add", {…})` or a helper; Zeff's own page makes the request for it and
  names the plugin (a panel's frame is sandboxed and can't send requests itself).

The token is made from a secret in Zeff's data folder; it identifies **one plugin** and is only good for the plugin
being on. Don't write it to logs or files.

`x-zeff-account` picks the account the call is for (default: the one you're in). Hooks get the account of the
event as `ZEFF_ACCOUNT` — pass it on.

Requests from other websites are refused (Zeff's usual guard); so is anything with an `Origin` that isn't Zeff's own.

## Methods

Parameters marked * are required.

### `hello`

No permission. `{}` → `{ apiVersion, plugin: { id, name, version }, account: { id, name }, permissions: string[], ungranted: string[] }`.
`permissions` is what the plugin may do right now; `ungranted` what its manifest asks for beyond what you granted
(turn it off and on). In a panel, `zeff.ready` resolves with this plus `context` (see [panels](panels.md)).

### Storage — no permission

A small JSON store of the plugin's own, per account (1 MB in all, keys up to 200 characters).

| Method | Params | Result |
| --- | --- | --- |
| `storage.get` | `key`* | the value, or `null` |
| `storage.set` | `key`*, `value`* (any JSON) | `true` |
| `storage.delete` | `key`* | `true` |
| `storage.keys` | — | `string[]` |

### Work — runs

A *run* is one worker's turn on a todo; a session is the runs on that todo.

| Method | Permission | Params | Result |
| --- | --- | --- | --- |
| `work.runs.list` | `work.read` | `limit` (1–200, default 50), `status`, `ticket`, `todoId` | `Run[]`, newest first |
| `work.runs.get` | `work.read` | `id`* | `Run` + `result`, `repo`, `cwd`, `base`, `sessionId`, `turns`, `gitSummary` |
| `work.runs.log` | `work.read` | `id`*, `from` (default 0) | `{ status, lines: LogLine[], next }` — up to 500 lines from `from`; continue with `from = next` |
| `work.runs.cancel` | `work.write` | `id`* | `true` |

`Run`:

```ts
{
  id: number; ref: string;            // "W-12"
  ticket: string; todoId: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
  mode: "code" | "draft" | "send" | "mr" | "ops" | "instruct"; provider: "claude" | "copilot" | "codex" | "zeff" | "agent";
  model: string | null;
  outcome: "done" | "partial" | "blocked" | null;
  summary: string | null;             // the worker's report (up to 4000 characters)
  error: string | null;
  branch: string | null;
  startedAt: string | null; finishedAt: string | null;   // ISO timestamps
  durationMs: number | null; costUsd: number | null;
}
```

`LogLine` (the conversation as the Work tab shows it):
`{ k: "start" | "say" | "tool" | "out" | "deny" | "end" | "raw", text: string, tool?: string, ok?: boolean, error?: boolean, model?: string }` —
`say` is the worker's words, `tool` a tool call (`tool` is its name), `out` a result, `end` how the run ended.

### Work — sessions

| Method | Permission | Params | Result |
| --- | --- | --- | --- |
| `work.sessions.start` | `work.write` | `instruction`*, `ticket` (a key like `ABC-123`), `repoId`, `provider` | `{ runId }` |
| `work.sessions.send` | `work.write` | `runId`*, `message`* | `{ runId }` |

`start` does what the message box does: a new todo (on the ticket, or none) and a worker on it, with the backend and
settings from Work's settings. `send` goes on with that run's conversation — while the worker still answers, the message
is queued behind it. Both show up in Work's sidebar like any session.

### Todos

| Method | Permission | Params | Result |
| --- | --- | --- | --- |
| `todos.list` | `todos.read` | `status` (`open` default, `done`, `dismissed`, `all`), `ticket`, `limit` (≤ 500, default 200) | `Todo[]` |
| `todos.add` | `todos.write` | `text`* (≤ 500), `ticket` | `{ id, ref }` |

`Todo`: `{ id, ref, ticket, text, kind, owner: "me" | "other", status, due: string | null, parentId: number | null, source: string | null }`.

### Kanban

Needs the Kanban plugin to be installed. Cards are the ones on your own boards (`KB-<id>`).

| Method | Permission | Params | Result |
| --- | --- | --- | --- |
| `kanban.boards.list` | `kanban.read` | — | `{ id, name, description, cards, open, inLage }[]` |
| `kanban.boards.get` | `kanban.read` | `id`* | the board with its `columns` (each with its `cards`) |
| `kanban.cards.add` | `kanban.write` | `columnId`*, `title`*, and any of `description`, `labels`, `priority`, `due`, `assignee` | the card |
| `kanban.cards.update` | `kanban.write` | `id`*, and any of `title`, `description`, `labels`, `priority` (`low`, `normal`, `high`, `urgent` or `null`), `due` (`YYYY-MM-DD` or `null`), `assignee` | the card |
| `kanban.cards.move` | `kanban.write` | `id`*, `columnId`*, `before` (a card id; none: at the end) | `true` |
| `kanban.cards.archive` | `kanban.write` | `id`* | `true` |
| `kanban.cards.unarchive` | `kanban.write` | `id`* | `true` |

`card`: `{ id, ref, columnId, title, description, labels, priority, due, assignee, parentId, doneAt }`.

### AI steps (LLM)

The instructions and numbers of the AI steps (Menu → Prompts: the briefing, the mail review, the branch names …).

| Method | Permission | Params | Result |
| --- | --- | --- | --- |
| `llm.steps.list` | `llm.read` | — | `{ id, label, extra, numbers }[]` |
| `llm.steps.update` | `llm.write` | `step`*, `extra` (the whole new instruction text), `numbers` (`{ key: value }`, held to the step's limits) | `true` |

### Workspace

Pages and databases of the Workspace — by their names (or ids).

| Method | Permission | Params | Result |
| --- | --- | --- | --- |
| `workspace.rows.add` | `workspace.write` | `database`* (name or id), `title`, `fields` (a JSON object, field name → value: a select's / status' option by its name, a date `YYYY-MM-DD`, a checkbox yes / no), `markdown` (its page's text) | `{ id }` |
| `workspace.rows.update` | `workspace.write` | `database`*, `row`* (title or id), `fields`, `markdown` (added at its page's end) | `{ id }` |
| `workspace.pages.create` | `workspace.write` | `title`*, `parent` (a page's title or id), `markdown` | `{ id }` |
| `workspace.pages.append` | `workspace.write` | `page`* (title or id), `markdown`* | `{ id, text }` |

The AI may also propose `llm.steps.update` (and `kanban.cards.add`, the `workspace.*` methods, `todos.add`) as an **Auto-Aktion** from what a colleague wrote
("Do in Zeff"): a method is offered to the AI by an `offer` on it (`ApiOffer` in `lib/plugins/api-kit.ts`), with the
current state as context so the new text adjusts what is there.

## Plugins bring their own methods

Every plugin — built-in or external — adds to the API the same way: the methods and the permissions they use are
registered by the plugin itself (a built-in plugin's `src/plugins/<id>/server.ts`), so a method is there exactly
while its plugin is installed. Built-in code calls the same methods in-process (`callBuiltin` in
`src/lib/plugins/api.ts`); external plugins call them over HTTP with their token. A permission a manifest asks for
must be one a plugin brings (a typo is refused); the list of what is on offer is on the Plugins page.

## Panel-only methods

`ui.toast`, `ui.navigate`, `ui.resize` exist only in a panel (the page around the frame handles them) — see
[panels](panels.md).

## Versioning

`apiVersion` in the manifest says what the plugin was written for. Version 1 methods keep their names, parameters
and result fields; new fields may appear, so ignore ones you don't know. A future breaking change gets version 2,
and Zeff will say in its release notes how long version 1 stays supported.
