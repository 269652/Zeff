# Event hooks

A hook is a program Zeff starts when something happens. Declare it in the manifest (and give the plugin the
`exec` permission):

```json
"permissions": ["exec", "todos.write"],
"contributes": {
  "hooks": {
    "work.run.finished": { "command": ["node", "./on-finished.mjs"], "timeoutMs": 5000 }
  }
}
```

## Events

| Event | When | `data` |
| --- | --- | --- |
| `work.run.started` | a Work run began working | `{ run }` |
| `work.run.finished` | a run ended — done, failed, stopped or interrupted (also one taken out of the queue) | `{ run }` |
| `work.changed` | something in Work changed (a message, a state …) | `{}` — at most one per half second |
| `todos.changed` | something in the todos changed | `{}` — at most one per half second |

`run` is the same object as the API's `Run` ([api](api.md)): `id`, `ref`, `ticket`, `todoId`, `status`, `mode`,
`provider`, `model`, `outcome`, `summary`, `error`, `branch`, `startedAt`, `finishedAt`, `durationMs`, `costUsd`.
For `work.run.finished` its state is final: `status` and `summary` are what you'd read afterwards.

Runs by Zeff itself (operations, merge requests, replies) are announced too: look at `provider === "zeff"` if
you want to skip them.

## What a hook receives

**On stdin**, one line of JSON, then the end of input:

```json
{
  "event": "work.run.finished",
  "plugin": "run-notifier",
  "account": "default",
  "at": "2026-10-11T08:15:02.113Z",
  "data": { "run": { "id": 12, "ref": "W-12", "status": "failed", "ticket": "ABC-7", "error": "…" } }
}
```

**In the environment** — Zeff's own, minus its secrets (the work token, the MCP token, `DATABASE_PATH`, Next's
variables, `NODE_ENV`), plus:

| Variable | Value |
| --- | --- |
| `ZEFF_API_URL` | where to call the [API](api.md), like `http://127.0.0.1:9333` |
| `ZEFF_EXT_TOKEN` | the plugin's token for the API |
| `ZEFF_EXT_ID` | the plugin's id |
| `ZEFF_ACCOUNT` | the account the event is from (send it as `x-zeff-account`) |
| `ZEFF_PLUGIN_DIR` | the plugin's folder |
| `ZEFF_EVENT` | the event name |

The **working directory** is the plugin's folder.

## How it runs

- `command` is the program and its arguments, **no shell** — no pipes or `&&`. Write a script and run that.
  `"node"` means the Node that runs Zeff (always there, also in the packaged app). `./x` is relative to the plugin
  folder. Everything else is looked up on the PATH as usual — which in the packaged app is **not** your shell's: use
  `node` for scripts, or an absolute path.
- **Fire and forget.** The hook never delays Zeff. One process per event and plugin.
- **Time limit:** `timeoutMs` (200–30000, default 5000). A hook that doesn't end is killed together with what it
  started.
- **At most four hooks of one plugin run at once.** Further events are skipped (and noted in the log).
- **Exit code:** 0 is fine; anything else is a failure. Output (stdout and stderr, the last 4 KB) is kept.
- **The log:** the last runs of each plugin show on the Plugins page (✓ / ✗, the event, how long, the first line of
  the output when it failed), and failures go to Zeff's server log.
- Only plugins that are **on** and were **granted** `exec` get events. If an update adds hooks the plugin wasn't
  granted `exec` for, they're held back until you turn it off and on again.

## A hook script

`on-finished.mjs` — turn a failed run into a todo:

```js
import fs from "node:fs";

const event = JSON.parse(fs.readFileSync(0, "utf8"));       // stdin
const run = event.data.run;
if (run.status !== "failed" || run.provider === "zeff") process.exit(0);

const res = await fetch(`${process.env.ZEFF_API_URL}/api/ext/v1/todos.add`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ZEFF_EXT_TOKEN}`, "x-zeff-account": process.env.ZEFF_ACCOUNT },
  body: JSON.stringify({ ticket: run.ticket || undefined, text: `Look at ${run.ref}: ${(run.error || "failed").slice(0, 150)}` }),
});
const j = await res.json();
if (!j.ok) { console.error(j.error.message); process.exit(1); }
```

## Patterns

- **Notify:** post to a chat webhook on `work.run.finished` (the plugin needs no `network` — that's for panels; a hook
  is a normal program and can reach the network).
- **React:** on `work.run.finished` with `outcome: "partial"`, send the worker a follow-up with `work.sessions.send`
  (needs `work.write`).
- **Keep records:** append to a file in the plugin folder, or write to `storage.set` through the API.
- **Don't loop:** a hook that starts a run is announced again when that run ends. Check `run.ref`/`ticket` or keep a
  counter in `storage` before you start another.
