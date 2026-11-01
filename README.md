<p align="center">
  <img src="site/favicon.svg" width="88" alt="">
</p>

<h1 align="center">Zeff</h1>

<p align="center">
  <b>A personal operating system that runs on your machine, reads everything you work with,<br>
  tells you what's to do — and extends itself while it runs.</b>
</p>

<p align="center">
  <a href="https://getzeff.com">Website</a> ·
  <a href="https://github.com/269652/zeff-alpha/releases">Download (alpha)</a> ·
  <a href="docs/plugins/README.md">Write a plugin</a> ·
  <a href="LICENSE">Licence</a> ·
  <a href="mailto:info@getzeff.com">info@getzeff.com</a>
</p>

---

Your work is spread over a dozen apps: tickets in Jira, mail in Outlook and Gmail, chats in Teams, WhatsApp and
Signal, notes in Keep, merge requests in GitLab, meetings in two calendars. Zeff reads all of them — **locally,
through the web apps you are already signed in to** — and turns them into one picture: what happened, what is open,
who is waiting for you, and what you should do next. Then it puts AI agents to work on it in your own repos.

Nothing leaves your PC unless you send it. The data is one SQLite file per account. Zeff never writes anywhere —
no message, no comment, no booking — unless you click the button.

## Why Zeff

- **One place for everything that waits.** Todos with their context, due dates and ready-made actions; open loops
  (what you promised, what was promised to you, questions nobody answered); a *Today* page that is your day on one
  screen.
- **Local first, for real.** A Next.js server on `127.0.0.1`, an Electron launcher, SQLite. No cloud account, no
  OAuth app to approve: connectors read the web apps in an automation browser with *your* sign-ins.
- **Agents on your todos.** Claude Code, Codex and Copilot CLI run in your repos with live sessions, worktrees,
  diffs and delivery — started from a todo, steered from the **Work** tab.
- **It extends itself.** Drop a folder into the plugins folder and Zeff gains rules, `/` commands, views, tools and
  hooks — no rebuild, no restart. Or ask a worker to write that plugin for you.
- **Careful by construction.** Automatic steps only read and propose; every write has a fixed list of callers,
  enforced by a test. Sources and databases carry a sensitivity (open, personal, secret) that every exit — the AI,
  the knowledge server, agents, MCP — respects.

## What's inside

| Area | What you get |
| --- | --- |
| **Today & Todos** | The *Lage*: an AI pass over tickets, mail, chats and merge requests that says what happened and what's to do. Todos keep their sources, a cause chain and one-click actions. |
| **Mail & Chat** | Outlook, Gmail, Teams, WhatsApp and Signal in one inbox with a mail client and a chat view; AI reviews flag what needs you. |
| **Workspace** | Pages and databases in the spirit of Notion — block editor, backlinks, history, table / board / calendar views, formulas with units — wired into everything else (send a mail to a board, link a row to a todo). |
| **People** | A profile for everyone who matters: notes, birthdays and reminders, what Zeff knows about them across sources, what they owe you and you them, identity suggestions that merge duplicates. |
| **Cases & Finances** | One place per matter (a file number in a letter, a mail and a todo hold it together); debts and claims with instalments and the day you are debt-free. |
| **Time** | Time tracking on jobs and projects, working hours, absences, flex time, week and month reports; agents propose bookings, you take them over. |
| **Calendar** | Your calendars in Zeff plus Outlook and Google Calendar in one view; meetings become time entries on a click. |
| **Knowledge** | A second server compiles Confluence, Keep, documents and Zeff's own data into a searchable wiki and graph — ask it in Zeff, or let agents search it over MCP. |
| **News** | Feeds and searches you pick, scored by your interests, muted words and how you actually read. |
| **Timeline, Loops, Correlations** | One log of what happened across all sources; what is still open between you and others; what goes with what in your days (computed, not guessed). |
| **Documents** | Drop PDFs, Office files, pictures or audio — Zeff extracts the text and files it into knowledge. |
| **Accounts** | Run work and private side by side: each account has its own database, browser profile, knowledge server and plugins. |

Everything built in is a plugin too: turn on what you use under **Menu → Plugins**. The UI speaks English, German
and Spanish.

## Get it

Download the archive for your system from the
**[releases](https://github.com/269652/zeff-alpha/releases)** — it brings the launcher, its own Node and Zeff,
built. No Node, npm or checkout needed.

| System | Archive | Start |
| --- | --- | --- |
| Windows 10/11 x64 | `Zeff-<version>-windows-x64.zip` | `Zeff\Zeff.exe` |
| Ubuntu 22.04+ x64 | `Zeff-<version>-linux-x64.tar.gz` | `Zeff/zeff` |
| macOS | `Zeff-<version>-macos-*.zip` (when built) | `Zeff.app` (unsigned: "Open Anyway" once) |

1. Unpack it anywhere (on Windows not into `Program Files` — Zeff keeps its data next to `Zeff.exe`).
2. Start it and say yes to the one-time setup of `https://zeff` (a hosts entry and Zeff's own certificate; without it
   Zeff runs on `https://127.0.0.1:1337`).
3. Follow **Setup** in the app: plugins, sign-ins, first data.

An update replaces the program and keeps the data (Windows `app\data`, macOS `~/Library/Application Support/Zeff`,
Linux `~/.local/share/zeff`). Every archive has a `.sha256` next to it and a `README.txt` inside.

**What your PC still needs** depends on the plugins you turn on — the **Plugins** and **Setup** pages show ✓ / ✗ with
a hint for each:

| For | Needs |
| --- | --- |
| Connectors that read web apps (Outlook, Teams, GitLab, Gmail, WhatsApp, Keep, Google Calendar) | a Chromium browser — Chrome, Edge, Brave or Chromium (`CHROME_PATH` overrides) |
| Work tab, Repos | `git` |
| Jira sync | `uvx` (uv) for `mcp-atlassian`, or any Jira MCP server via `JIRA_MCP_COMMAND` |
| AI | the Claude CLI, Codex CLI or Copilot CLI, signed in once |
| Scanned PDFs, audio | Poppler's `pdftoppm`; a transcriber such as Whisper |

## Make Zeff yours: plugins

External plugins are plain folders in Zeff's data folder. They appear under **Menu → Plugins** at once, and you turn
them on there after seeing what they ask for.

```
plugins/my-plugin/
  zeff-plugin.json   ← what it adds, and what it may do
  ui/index.html      ← a view of your own, inside Zeff
  rules.md           ← rules every Work worker gets
```

```json
{
  "id": "hello", "name": "Hello", "apiVersion": 1,
  "permissions": ["prompt", "work.read"],
  "contributes": {
    "workerRules": "rules.md",
    "workCommands": [{ "id": "tests", "label": "tests", "template": "Run the tests and tell me what fails." }],
    "workPanels": [{ "id": "runs", "title": "Hello runs", "entry": "index.html" }]
  }
}
```

| A plugin can add … | So Work … |
| --- | --- |
| **Rules** for every worker | behaves your way: house style, checks before "done", words to avoid |
| **`/` commands** | starts the jobs you do all the time with one keystroke |
| **Views** in the sidebar or as a session tab | shows what you care about: run dashboards, costs, a ticket next to its session |
| **MCP servers** | reaches your own systems |
| **Event hooks** on runs and todos | reacts: notify, log, open a todo when a run fails, send a follow-up |
| **The API** | is driven by your code: start sessions, add todos, keep data |

A hook can start a session, and a session's end is itself an event — so a plugin can close the loop: **Zeff acting
on Zeff**. The `plugin-builder` example adds a `/plugin` command: describe what you want, and a worker reads Zeff's
own docs, writes the plugin and tells you what it asks for. Nothing it writes runs until you turn it on.

Views run in a sandboxed frame behind a permission-checked bridge; hooks have time limits and no shell. The one
permission that can't be contained is `exec`, and Zeff says so before you enable it —
[the trust model](docs/plugins/security.md).

Start with the [overview](docs/plugins/README.md) and the examples in [`examples/plugins/`](examples/plugins)
(`run-dashboard`, `run-notifier`, `plugin-builder`). Reference: [manifest](docs/plugins/manifest.md) ·
[API](docs/plugins/api.md) · [panels](docs/plugins/panels.md) · [hooks](docs/plugins/hooks.md).
`npm run plugin:check -- <folder>` validates a plugin.

Integrations that must not live in a public repo (a company's own timesheet, for example) can be kept in a private
repository and mounted as a git submodule under `integrations/` — [docs/integrations.md](docs/integrations.md).

## Connect an agent (MCP)

Every account has its own MCP endpoint; the `/mcp` page lists them with ready-to-paste config.

```bash
claude mcp add --transport http --scope user zeff http://127.0.0.1:9333/api/mcp
```

Agents can book time (`report_time`, `list_time_entries` …), work on todos (`list_todos`, `start_todo`,
`todo_context`, `finish_todo` …) and search knowledge (`search_knowledge`). Each endpoint takes the token of its
account (`Authorization: Bearer …`, Menu → MCP).

## How it works

```
 Web apps you're signed in to          Zeff (Next.js 16, 127.0.0.1)                You
 ─────────────────────────────         ───────────────────────────────            ─────
 Outlook · Teams · Gmail · Keep  ──►   drivers (MCP over stdio, CDP)  ──►  SQLite  ──►  Today · Todos · Mail
 WhatsApp · GitLab · Calendar           syncs ─► Lage (AI) ─► todos      per          Workspace · People
 Signal Desktop · Jira (MCP)            knowledge server · agents        account      Work (agents) · MCP
```

- **Drivers.** Each connector is a small MCP stdio server (`src/plugins/<id>/driver.mjs`) that attaches over CDP to
  the account's automation browser and reads the web app like you would. Sign-ins are yours — Zeff asks, never
  signs in itself. Signal is read from Signal Desktop's own objects, without opening chats or marking them read.
- **The Lage.** Syncs feed an AI pass that turns new activity into todos, loops and reviews. Prompt changes are
  checked with before/after evals on your own past decisions (`npm run eval`, [docs/evals.md](docs/evals.md)).
- **Knowledge.** A Next app of its own per account (`knowledge/`) compiles each page once per version — summary,
  concepts, entities, relations — and answers searches and questions.
- **The launcher.** Electron supervises Zeff and the knowledge servers, serves them as `https://zeff` and
  `https://knowledge.zeff`, restarts them after a crash, and starts with the OS.

Stack: Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Drizzle ORM + better-sqlite3, MCP SDK v2,
Playwright over CDP, Electron.

## Develop

```bash
npm install
npm run dev                    # on a free port
npm test                       # each test file on its own temporary database
npm run test:server            # a disposable server: fresh database, free port, TTL
npm run e2e                    # the browser smoke suite
npm run deploy                 # typecheck, lint, tests, build, restart through the launcher, page probes
```

- **Migrations** are written by hand: `drizzle/00NN_name.sql` (statements separated by `--> statement-breakpoint`)
  plus an entry in `drizzle/meta/_journal.json` with a `when` greater than every earlier one. Don't run
  `db:generate` — its snapshots are long out of date.
- **Risky writes** are tested on a snapshot (`better-sqlite3` `backup()`, `DATABASE_PATH`), never on the live
  database.
- **Writes only on a click** is a test: `tests/safety.test.ts` fails when an automatic step reaches a write.
- **A release** is `npm run release` on the system it is for (native modules): it builds a commit from
  `git archive`, packs the archive with its `.sha256`, then unpacks and starts it with a bare `PATH` and checks
  pages, drivers, work hosts and migrations. `npm run release:check -- <archive>` runs that check alone.

```
src/app/          pages, API routes (api/mcp, api/ext/v1), server actions
src/plugins/<id>/ a built-in plugin: manifest, driver.mjs, server actions, UI
src/lib/          the core: entries, schedule, boards (the Lage), work, sync, mail, ext (external plugins)
src/db/           Drizzle schema, connections, accounts
knowledge/        the knowledge server
launcher/         the Electron launcher
docs/             documentation; docs/plugins is shipped with Zeff (/ext/docs)
examples/plugins/ plugins to copy
tests/  e2e/      node:test + tsx; Playwright smoke suite
```

## Status

Zeff is **alpha**. It is used every day, on Windows first; Linux builds are checked, macOS builds are not published
yet. Expect rough edges, migrations and the occasional breaking change.

## Licence

Free for personal, non-commercial use during alpha and beta (versions below 1.0); commercial use needs a licence, and
from 1.0 on Zeff is paid. The terms are in [LICENSE](LICENSE). Questions and commercial licences:
[info@getzeff.com](mailto:info@getzeff.com). The landing page lives in [site/](site) and is published to
[getzeff.com](https://getzeff.com).
