<p align="center">
  <img src="site/favicon.svg" width="88" alt="">
</p>

<h1 align="center">Zeff</h1>

<p align="center">
  <b>Everything that reaches you becomes one todo list.<br>
  Mail, chats, tickets, comments, appointments, letters and bank statements flow in —<br>
  Zeff derives what is yours to do, tells you why, and puts the button that finishes it right beside it.<br>
  Locally, on your machine. Nothing leaves it unless you say so.</b>
</p>

<p align="center">
  <a href="https://getzeff.com">Website</a> ·
  <a href="https://github.com/269652/zeff-alpha/releases">Download (alpha)</a> ·
  <a href="#features">Features</a> ·
  <a href="docs/plugins/README.md">Write a plugin</a> ·
  <a href="LICENSE">Licence</a> ·
  <a href="mailto:info@getzeff.com">info@getzeff.com</a>
</p>

---

Your day is spread over a dozen channels. Tickets in Jira. Mail in Outlook, Gmail and that old T-Online account. Chats
in Teams, WhatsApp and Signal. Review comments in GitLab. Two calendars. A letter with a file number. A bank statement
you keep meaning to look at. Somewhere in all of that is the one message you should answer today — and the promise
you made last Tuesday.

**You shouldn't have to turn that into a todo list by hand. Zeff does.** It reads every channel, locally, and derives
your todos from what actually comes in: who asked you for what, by when, in which message — and what already happened
since. A reply you sent, a ticket that moved, a payment that arrived: the todo settles itself. What's left is one calm
list, each item with its sources, its reason and a ready-made action.

```
  Outlook · Gmail · IMAP/POP3 ───┐
  Teams · WhatsApp · Signal ─────┤                           ┌────────────────────────────────────┐
  Jira · GitLab reviews ─────────┼──►  read · understood ───►│  Your todos                        │
  Calendars · documents · bank ──┤     matched · deduped     │  why · from where · by when · next │
  Workspace · journal · agents ──┘                           └────────────────────────────────────┘
```

Around that list sits everything you need to work it off: a mail client and chat view, a Notion-like workspace, AI
agents that take todos over in your own repos, and a **Studio** to build whatever else you need.

- 📥 **Every channel in, one list out.** Todos are a derivation of everything that arrives — not another inbox to
  feed by hand.
- 🏠 **Local first, for real.** A server on `127.0.0.1`, a desktop launcher, one SQLite file per account. No cloud
  account, no OAuth app to approve: connectors read the web apps you are already signed in to.
- ✋ **It never acts behind your back.** Automatic steps only read and propose; every write — a message, a comment,
  a booking — happens on your click. A test enforces it.
- 🤖 **Agents that actually work.** Claude Code, Codex and Copilot run on your todos with live sessions, worktrees,
  diffs and delivery — and they can ask you when they need a decision.
- 🔒 **Privacy you can see.** Every source and database carries a sensitivity (open, personal, secret) that the AI,
  the knowledge server, agents and MCP all respect.

## Features

### ✅ Todos — derived from everything that comes in

- **Every channel feeds the list** — mail (Outlook, Gmail, any IMAP/POP3 account), chats (Teams, WhatsApp, Signal),
  Jira tickets and comments, GitLab merge requests and review comments, your calendars, documents and letters, bank
  statements, Workspace notes and checklists, even Signal's "note to self".
- **Derived, not typed** — after every sync the AI reads what is new and decides what asks something of *you*. That
  becomes a todo; everything else stays context. Appointments that need preparing become todos for their day.
- **Every todo says why** — it keeps the messages it came from (with the quote it rests on), the chain of what caused
  it, the people involved and a due date where the source names one.
- **One thread, one todo** — later replies, comments and follow-ups land on the todo they belong to instead of
  making new ones; a conversation shares its todos, and every mail, note or ticket that flowed into one carries a mark
  — so nothing is handled twice.
- **It settles itself** — when the source leaves no doubt it is done: your reply went out, the ticket was resolved,
  the attachment was sent, the payment showed up on the bank statement. Each settling says what did it, and can be
  undone.
- **One-click actions** — for each open todo the AI prepares what would finish it: a reply, a comment, a mail draft,
  a meeting in a free slot, a hand-over to an agent. You review, adjust, click.
- **Context at a glance** — hover a todo for its sources, actions and what the knowledge base has on it; open it for
  the whole story.
- **Hand it to an agent** — a todo can go to Claude Code, Codex or Copilot in the right repo; its run, diff and
  delivery come back to the same todo.

### ☀️ Today — your day on one screen

- **The briefing ("Lage")** — an AI pass over your tickets, mail, chats and merge requests that says what happened and
  what is yours to do, ticket by ticket, with flags and suggested next steps.
- **Open loops** — what you promised ("I'll send it tomorrow"), what was promised to you, questions nobody answered,
  review and signature requests. Loops close by themselves when the source leaves no doubt.
- **Timeline** — one log of everything across all sources, tied to the people, tickets, cases and projects it
  concerns, with a marker for what is new since you last looked.
- **Reminders that matter** — birthdays and anniversaries, deadlines, instalments, the overdue promise — on the Today
  page and as desktop notifications.

### 📬 Every inbox, one place

- **All your mail accounts side by side** — Outlook (web or Microsoft's API), Gmail, and any IMAP or POP3 account
  (T-Online, GMX, WEB.DE, Gmail, Outlook …). Reply and write new mail from Zeff, really sent over the account's SMTP.
- **Chats too** — Microsoft Teams mentions and chats, WhatsApp Web and Signal Desktop *(both experimental)* — read without
  opening a chat, so nothing is marked as read and no blue ticks appear.
- **A real mail client and chat view** — folders, list and reading pane; conversations with a reply box that stays at
  the bottom; channel logos as tabs; "archive read" that tidies the IMAP inbox on the server too.
- **AI reviews** — the mail and message review flags what needs you and turns it into todos, with the quote it is
  based on.

### 🗂️ Workspace — Notion, wired into everything

- **Pages and databases** — a block editor (`/` for blocks: headings, lists, checklists, tables, callouts, toggles,
  code, pictures), a page tree with backlinks, history and a trash.
- **Every view you need** — table, board, list, gallery, calendar, timeline and chart; filters, sorts, relations,
  rollups and formulas **with units** (`3 h × 85 €/h`).
- **Views of your own design** — describe a view or write it in Zeff's template language: dashboards, galleries,
  two-pane apps, an inbox. Edit it in a **drag & drop builder** with a kit of ~40 elements, or in a code editor with
  syntax highlighting and completion — with a live preview either way.
- **Detail pages for any database** — the page a row opens as, designed like a view: its fields, its lifecycle
  buttons, data a flow loads.
- **Lookups** — type a title and pick a suggestion: films and series (TMDB), books (Open Library, Google Books),
  Wikipedia articles, the Knowledge Graph, web results — and its data becomes a row, poster and all.
- **Checklists that are todos** — a note's checkboxes are Zeff todos, ticked from anywhere.
- **@-mentions** of people, todos and tickets; forms that fill databases; templates for a journal, an agenda and more.
- **AI built in** — it writes and summarises, turns a page into todos, fills AI fields per row, answers questions from
  a database (each statement naming its row), and compiles a dossier of what a database says.

### 🧱 Studio — build your own apps *(beta)*

- **Flows from blocks** — web requests, lookups, AI extraction, rows read and written, branches, loops, parallel
  steps, error handling, sub-flows and JavaScript in a sandbox. Drawn as a canvas; every node's input and output in the
  run console; dry runs that write nothing.
- **Ask me** — a block that asks *you* a question (a 1–10 scale, a choice, yes/no, a number, a text) and waits for the
  answer — on any page of Zeff, as a card in the corner. An hourly check-in that lands in your journal is three
  blocks: *ask → make sure of the database → write the row*.
- **Triggers** — by hand, from a button in a view, on a schedule with hours and weekdays ("every hour from 8 to 22,
  Monday to Friday"), when a row changes, on a lifecycle transition or a signal.
- **Lambdas** — real Node.js functions with their own npm packages, each in a sandboxed process (no files, no
  processes, network only to the domains it declares, through Zeff). Their output is checked against what they
  promise. All lookup sources are lambdas you can read, test and change.
- **A web IDE** — the editor of VS Code in the browser: files, tabs, highlighting, completion with the types of the
  lambda's event, context and installed packages, a test panel, full screen.
- **Lifecycles** — turn a status field into a state machine: transitions, conditions, required fields, a history per
  row, flows on entering and leaving a state, and a strict mode where a card only moves the way it may.
- **Apps in one click** — a web search that keeps what you find, a film catalogue, a tracker, or an empty app — each a
  database with its own screens, detail page and flows. Or just *describe it* and let the assistant build it from the
  same blocks.
- **Permissions you grant** — a flow reaches only the web domains, databases, AI and sending you allow; what the AI
  asks for waits for your OK. Secrets (API keys) never show in a log.

### 🤖 Agents & AI

- **Bring your AI** — Claude Code, OpenAI's Codex (your ChatGPT account) or GitHub Copilot as the backend, each task
  with its own model; your instructions and context go with every call.
- **Code tab** — workers on your todos with live sessions you can steer, branches and worktrees, diffs, pushes, merge
  requests and replies to review comments on a click. Admin sessions for system work on Windows *(beta)*.
- **Workspace agents** — scheduled agents that write reviews, clean up an inbox, fill databases — with a scope, tool
  groups you switch on and off, and a log of every run. Each agent sees the data beside it: drop a database into
  your journal and the weekly review reads it.
- **They ask when they need you** — an agent can ask you a question mid-run (`zeff_ask`), wait for the answer and go
  on with it.
- **MCP for every agent** — Zeff's tools over MCP: todos, time, knowledge, the Workspace, flows, lookups, open loops,
  the timeline, correlations, web search and an automated browser *(beta)*.

### 👥 People, cases & money

- **People** — a profile for everyone who matters: notes, dates with reminders, what Zeff knows about them across
  sources, their latest messages, the todos they appear in, what they owe you and you them. Duplicates are found and
  merged everywhere at once.
- **Organisations, projects & places** — known under every name your sources use, each gathering its people,
  tickets, mails, money, hours and appointments.
- **Cases** — one place per matter: the file number in a letter, a mail and a todo holds it together; the other party,
  what is owed, the next instalment or deadline and a GiroCode to pay.
- **Finances** — whom you owe what and who owes you, payment plans, the months ahead as a chart, the day you are
  debt-free; bank statements (Revolut and other CSVs) settle payments by themselves.

### 🕐 Time & calendar

- **One calendar** — your own calendars plus Outlook and Google Calendar in one week view; free slots for meeting
  suggestions; meetings become time entries on a click.
- **Time tracking** — jobs and projects, working hours, absences, flex time, weekly and monthly reports; agents
  propose bookings, you take them over.

### 🧠 Knowledge & insight

- **A knowledge server** — Confluence, documents and Zeff's own data compiled into a searchable wiki and graph:
  summaries, concepts, entities, relations. Ask it in Zeff, or let agents search it.
- **What you should know right now** — before a meeting, beside a mail, a ticket or a person.
- **Questions about your own numbers** — "how much did I spend on repairs this year?", "when did I last talk to …?" —
  answered from your data, with the rows behind the answer.
- **Documents** — drop PDFs, Office files, pictures or audio; Zeff extracts the text (scans and audio too) and files it.
- **Correlations** — what goes with what in your days (your mood and energy against meetings, hours, messages,
  spending), computed with real statistics and only told when it holds.

### 🌱 Life

- **Journal** — a diary with mood, energy and tags, weekly and monthly reviews written by the AI, and check-ins that
  ask you during the day.
- **Agenda** — notes on a timeline in projects, on the agenda, pinned, with reminders and today's calendar events.
- **News** — the feeds you pick plus a search per interest, scored by what you care about and how you read; muted
  words, trusted sources, a daily overview.

### 🛡️ Safe by construction

- **Accounts** — work and private side by side, each with its own database, browser profile, knowledge server, AI
  backends and plugins.
- **Encrypted backups** — daily ZIPs, AES-256 with your password, daily/weekly/monthly rotation, restore in one click;
  optionally a copy in your own Google Drive *(beta)*.
- **Sensitivity everywhere** — mark a source or database personal or secret and every exit respects it.
- **Writes only on a click** — enforced by a test, not a promise.

### 🧩 Make it yours

- **Plugins** — everything in Zeff is a plugin you turn on or off; drop a folder into the plugins folder to add rules,
  `/` commands, views, MCP servers, hooks and API calls — no rebuild, no restart.
- **Three languages** — English, German and Spanish, with dates and numbers in your format.

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

## Disclaimer

**Zeff is provided "as is", without any warranty and without any liability.** You use it entirely at your own risk.
It can contain errors, lose or corrupt data, send or fail to send messages, miss or misread a todo, a deadline or a
payment, and stop working when a service it reads changes. Zeff is no substitute for your own checks: what it derives,
summarises or suggests — including anything the AI writes — may be wrong. Connectors that read third-party services
(WhatsApp, Signal, Teams, Outlook and others) may break those services' terms of use and can lead to your account being
restricted; using them, and getting the permission of your employer or IT department where needed, is your
responsibility. Keep backups.

To the extent permitted by applicable law, the author accepts no liability whatsoever for any damage arising from the
use of or the inability to use Zeff. Mandatory liability that cannot be excluded by law (under German law: for intent,
gross negligence and injury to life, body or health) remains unaffected. See sections 15 and 16 of the [AGPL](LICENSE).

## Licence

Zeff is free software under the [GNU AGPL-3.0](LICENSE): use it, at home or at work, change it and share it, as long
as what you pass on (or offer over a network) stays under the AGPL with its source. If that doesn't fit, for a closed
product, a hosted service without publishing your changes or a company that can't use AGPL software, there is a
[commercial licence](COMMERCIAL-LICENSE.md). How the two fit together is in [LICENSING.md](LICENSING.md);
contributions need the short agreement in [CONTRIBUTING.md](CONTRIBUTING.md). Commercial licences and questions:
[info@getzeff.com](mailto:info@getzeff.com). The landing page lives in [site/](site) and is published to
[getzeff.com](https://getzeff.com).
