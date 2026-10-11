# Zeff external plugins

External plugins let you extend Zeff — its **Work tab** in particular — **without touching its source and
without rebuilding it**. They work in a packaged Zeff (the release you download) exactly as in a checkout.

A plugin is a folder with a `zeff-plugin.json`. Put it into Zeff's plugins folder: it appears on **Menu →
Plugins → External plugins** at once (no restart), and you turn it on there. What it may do is named in its
manifest, and you see it before you turn it on.

## What a plugin can add to Work

| It adds | Where you see it | Needs |
| --- | --- | --- |
| **Rules for workers** — text files appended to what every Work worker is told | in every worker's system prompt | `prompt` |
| **"/" commands** — prompt templates | typing `/` in the message box | — |
| **Views (panels)** — your own HTML page, shown inside Zeff | a link in Work's sidebar (`tab`), or an extra tab of a session (`session`) | — |
| **MCP servers** — more tools for workers | the workers' tool list (`ext-<plugin>-<name>`) | `exec` (a program) or `network` (a URL) |
| **Event hooks** — programs started when something happens | `work.run.started`, `work.run.finished`, `work.changed`, `todos.changed` | `exec` |
| **The API** — read and drive Work from a panel or a hook | `zeff.work.…`, `zeff.todos.…`, `/api/ext/v1/…` | per method |

So a plugin can change how workers behave (rules, tools), how you start work (commands), what you see (panels),
and react to what happens (hooks, which can call the API to start sessions, add todos, store data …).

## Where the plugins folder is

| Zeff | Plugins folder |
| --- | --- |
| Windows release | `Zeff\app\data\plugins\` (tray icon → *Open plugins folder*) |
| macOS release | `~/Library/Application Support/Zeff/plugins/` |
| Linux release | `~/.local/share/zeff/plugins/` |
| A checkout | `data/plugins/` |

`ZEFF_PLUGINS_DIR` (an environment variable, or `env` in `zeff-launcher.json`) overrides it. The Plugins page
shows the folder Zeff is actually using.

Every plugin is a folder named like its id: `plugins/my-plugin/zeff-plugin.json`.

## A plugin in five minutes

`plugins/hello/zeff-plugin.json`:

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "A command, a rule and a view.",
  "apiVersion": 1,
  "permissions": ["prompt", "work.read"],
  "contributes": {
    "workerRules": "rules.md",
    "workCommands": [
      { "id": "tests", "label": "tests", "description": "Run the tests and report", "template": "Run the project's tests and tell me what fails." }
    ],
    "workPanels": [{ "id": "runs", "title": "Hello runs", "entry": "index.html" }]
  }
}
```

`plugins/hello/rules.md`:

```
Answer in short sentences. End every report with the line "— Hello".
```

`plugins/hello/ui/index.html`:

```html
<!doctype html>
<link rel="stylesheet" href="/ext/sdk/zeff.css">
<h1>Recent runs</h1>
<table id="runs"></table>
<script src="/ext/sdk/zeff.js"></script>
<script>
  async function load() {
    const runs = await zeff.work.runs.list({ limit: 10 });
    document.getElementById("runs").innerHTML = runs
      .map((r) => `<tr><td>${r.ref}</td><td>${r.status}</td><td>${r.ticket || ""}</td></tr>`)
      .join("");
  }
  load();
  zeff.on("change", (e) => e.topic === "work" && load());
</script>
```

Open **Menu → Plugins**, find *Hello* under *External plugins*, turn it on. Work's sidebar now has a *Hello runs*
view, typing `/` in the message box offers *tests*, and every worker gets the rule.

Check a plugin's manifest from the command line (in a checkout): `npm run plugin:check -- path/to/plugin`.

## Let Zeff write its own plugins

A plugin is plain text in a documented format, and Zeff serves its own docs as plain Markdown —
`http://127.0.0.1:9333/ext/raw/README` (also `manifest`, `api`, `panels`, `hooks`, `security`; the README says where
this computer's plugins folder is). That is all a Work worker needs to write a plugin for you: turn on
**plugin-builder** from the examples, type `/plugin` in Work's message box, describe what you want, and the worker
reads the docs, creates the folder and tells you what it asks for. Zeff loads it at once; you review it on the
Plugins page and turn it on yourself — nothing a worker writes runs until you do.

## How it works

- **Found at once.** Zeff reads the folders on every look (cached for 1.5 s): add, edit or delete a plugin and
  the app follows. Panel files are served from disk each time.
- **On or off per account.** Turning a plugin on means *you* grant what its manifest asks for at that moment. If an
  update asks for more, the new permissions stay held back until you turn the plugin off and on again.
- **Declarative.** Rules, commands, panels and MCP servers are data in the manifest — no code runs inside Zeff.
  Code runs in two places only: in a panel's sandboxed frame, and as programs Zeff starts for hooks and MCP
  servers (they need the `exec` permission and run with your rights).

## The documents

- [manifest](manifest.md) — every field of `zeff-plugin.json`, the permissions, the validation rules
- [api](api.md) — the extension API v1: every method, errors, how to call it
- [panels](panels.md) — writing views: the sandbox, `window.zeff`, styling, session panels
- [hooks](hooks.md) — events, what a hook receives, limits, patterns
- [security](security.md) — the trust model: what each permission really means

Examples to copy are in `examples/plugins/`: **run-dashboard** (a view, commands, rules, a session panel),
**run-notifier** (a hook that calls the API) and **plugin-builder** (a `/plugin` command that sets a Work worker up
to write a new plugin for you). The manifest also has a JSON Schema for editors:
`docs/plugins/zeff-plugin.schema.json`, or `http://127.0.0.1:9333/ext/sdk/zeff-plugin.schema.json` while Zeff runs
(`"$schema": "…"` in your manifest).
