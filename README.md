# Zeff

Zeff started as a *Zeiterfassung*: hourly time reports on job numbers, with an MCP server so a
coding agent can book the time it spent on a ticket. It has grown into a local work assistant
around that core:

- **Time tracking.** Entries on jobs and projects, working hours, absences, flex time, a weekly
  and a monthly report. Every agent booking arrives as a suggestion that you take over.
  *Feierabend* books the whole day in one go. Exports go to **Roar** and **TimO**.
- **Todos and the Ticket-Lage.** An AI pass over your Jira tickets, mail, chats and merge requests
  says what happened and what's to do. Its todos carry their context, due dates and ready-made
  actions. **Heute** is the day on one page.
- **Connectors.** Jira, Outlook mail and calendar, Gmail, Teams, WhatsApp, Signal, Google Keep and GitLab.
  They are read through their web apps in an *automation Chrome*, so no OAuth is needed.
- **Work.** Agents (Claude Code, Copilot CLI) run on your todos in your repos, with live sessions,
  branches and delivery.
- **Knowledge.** A second server compiles Confluence and Zeff's own data (tickets, chats, mail,
  notes, facts) into a searchable wiki and graph. You can ask it in Zeff, and agents can search it
  over MCP.
- **Accounts.** Zeff can run more than once, for example work and private. Each account has its
  own database, automation Chrome, knowledge server and plugins.

Everything is a **plugin**: install what you use on the Plugins page (Menu → Plugins). Zeff runs
only on this machine, and its data is local SQLite.

Stack: Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Drizzle ORM + better-sqlite3,
`mcp-handler` 2 / MCP SDK v2, and Playwright over CDP for the browser drivers. An Electron
launcher supervises it.

## Running it

| | |
| --- | --- |
| **Everyday** | The **launcher** (`dist\Zeff\Zeff.exe`, see [launcher/README.md](launcher/README.md)) runs Zeff on `127.0.0.1:9333` and one knowledge server per account (`:9555`, `:9556` …). It serves them as `https://zeff` and `https://knowledge.zeff`, restarts them after a crash, and starts with Windows (tray → "Start with Windows"). |
| **Deploy a change** | `npm run deploy` is the only way to update the running Zeff. It takes a lock, waits for no active run, then runs typecheck, lint, `npm test` and the build. It restarts through the launcher and probes the main pages. Use `-- --knowledge` to also build and restart the knowledge server, and `-- --wait` to wait for a running Lage or work run instead of refusing. |
| **Develop** | `npm run dev` (any free port) on the same database. Test risky writes on a snapshot (`better-sqlite3` `backup()`) with `DATABASE_PATH` set, never on `data/zeff.db`. |

```bash
npm install
npm test          # each test file on its own temporary database
npm run deploy    # typecheck, lint, tests, build, restart, page probes
npm run eval:mail # before/after of the Mail-Durchsicht prompt on your real mails — nothing may get lost
```

### Releases (Windows, macOS, Linux)

Others run Zeff from a release: one archive per system with the launcher, its own Node and Zeff
built — no Node, npm or checkout needed. Download it from the repository's GitHub Releases:

| System | Archive | Start |
| --- | --- | --- |
| Windows 10/11 x64 | `Zeff-<version>-windows-x64.zip` | `Zeff\Zeff.exe` |
| macOS (Apple Silicon / Intel) | `Zeff-<version>-macos-arm64.zip` / `-macos-x64.zip` | `Zeff.app` (into Applications; unsigned: "Open Anyway" once) |
| Ubuntu 22.04+ x64 | `Zeff-<version>-linux-x64.tar.gz` | `Zeff/zeff` |

**Using one:** unpack it anywhere (Windows: not into `Program Files` — Zeff keeps its data next to
`Zeff.exe`), start `Zeff.exe` / `Zeff.app` / `./zeff`, say yes to the one-time setup of `https://zeff`
(hosts entry + Zeff's own certificate, asks for admin rights; without it Zeff runs on
`https://127.0.0.1:1337`), then follow **Setup** in the app (plugins, sign-ins, first data). An update
replaces the program and keeps the data: Windows `app\data` and `app\knowledge\data`; macOS
`~/Library/Application Support/Zeff`; Linux `~/.local/share/zeff`. Each archive has a `.sha256` next to
it (`sha256sum -c`, or `Get-FileHash`), and a `README.txt` inside with the details for its system.

**What is inside:** the launcher (Electron), `runtime/node` (the Node that built it), and `app/` — Zeff and
the knowledge server, built, with production `node_modules` (better-sqlite3 and the other native modules
are those of the machine that built it, hence one archive per system), `drizzle/`, `scripts/` (work hosts,
browser helper), `src/plugins/*/driver.mjs` and `.mcp.json`. Not inside: tests, fixtures, `.github/`, data,
`.env`, `zeff-launcher.json`.

**What the PC still needs** — Zeff brings none of these; the **Plugins** and **Setup** pages list what the
installed plugins need ("This PC": ✓ / ✗ with a one-line hint), and a plugin without it says what to install:

| For | Needs | Get it |
| --- | --- | --- |
| Outlook, Teams, GitLab, Roar, TimO, Gmail, WhatsApp, Keep, Google Calendar (the *automation browser*) | a Chromium browser: Google Chrome, else Microsoft Edge (in every Windows 10/11), Brave, Chromium — or `CHROME_PATH` | install one; its profile is in `%LOCALAPPDATA%\Zeff`, `~/Library/Application Support/Zeff`, `~/.local/share/zeff` |
| Work tab (worktrees, diffs), Repos | `git` | `winget install Git.Git`, `xcode-select --install`, `sudo apt install git` |
| Jira sync | `uvx` (uv), which starts `mcp-atlassian`; or any Jira MCP server via `JIRA_MCP_COMMAND` | `winget install astral-sh.uv`, `brew install uv`, `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Claude / ChatGPT / Copilot plugins | the Claude CLI, Codex CLI (`npm install -g @openai/codex`, needs Node), Copilot CLI (`npm install -g @github/copilot`), each signed in once | |
| Scanned PDFs (Documents) | Poppler's `pdftoppm` — Zeff installs it with winget / scoop / Homebrew; on Linux `sudo apt install poppler-utils` | |
| Audio (Documents) | a transcriber command (e.g. Whisper) set in Documents → Settings | |

Everything else (the servers, the drivers, the work hosts, the database, the certificate) comes from the
bundle and runs with the bundled Node only; `npm`/`npx` aren't there either.

**Building one** (on the system it is for — native modules): `npm run release`. It builds the commit `HEAD`
(`--ref <commit|tag>` for another) from `git archive` in `<temp>/zeff-release`, never in the checkout, and
refuses when uncommitted changes would be left out (`--allow-dirty` builds the commit as it is). It packs
`dist/release/Zeff-<version>-<system>.zip|.tar.gz` (version: the tag, else the commit) with `<archive>.sha256`,
prints the version, size and sha256, and then **checks the archive** (`--no-check` skips it): it is unpacked
into a temp folder and started on its own ports and data with a bare `PATH` (no Node, git, uv, Chrome), the
pages open, and `app/scripts/bundle-check.mjs` runs on the bundled Node — files, dependencies, native module,
every driver's MCP handshake, both work hosts, the database migrated to the last migration, nothing of the
build machine in it. The exit code is 1 when the check fails. `npm run release:check -- <archive>` is that
check alone (`--inherit-env` keeps your `PATH`, `--keep` leaves the unpacked folder).

A tag starts the same on all systems: `git tag v0.2.0 && git push github v0.2.0`. The workflow
(`.github/workflows/release.yml`) builds on each system (`dist.mjs --release --no-check`), checks every
archive (`npm run release:check`), and publishes the GitHub release only when all of them pass. "Run
workflow" on the Actions tab builds and checks without publishing.

The database is created and migrated on first start (`drizzle/`). After editing
`src/db/schema.ts`, **write the migration by hand** (`drizzle/00NN_name.sql`, statements separated
by `--> statement-breakpoint`) and add it to `drizzle/meta/_journal.json` with a `"when"` greater
than every earlier one — Drizzle skips a migration whose `when` is lower than the last applied.
Don't run `npm run db:generate`: its snapshots stop at 0062, so it would recreate existing tables.

## Plugins

| Plugin | What it is |
| --- | --- |
| Zeiterfassung, Wochenbericht, Monatsbericht | Jobs and projects, working hours and absences, booking, the week and the month |
| Todos, Tickets | The Ticket-Lage, todos with their context, activity and recap; the Lage per ticket |
| Kanban, Jira Lage | Your own boards; your Jira boards with each card's Lage |
| Kalender | One calendar for everything: your own calendars in Zeff and your sources' (Outlook, Google Calendar) |
| Personen | A profile for each person who matters to you: your notes, their dates (birthdays …), reminders on Heute |
| Work | Agents on your todos: runs, live sessions, repos, delivery |
| Auto-Aktionen | Ready-made actions for every open todo, from what the installed plugins can do |
| LLM, Copilot CLI, Claude CLI | The AI layer: a backend and model per task, your instructions |
| Knowledge | The knowledge server's chat, and "Show knowledge" on todos |
| Jira, Outlook Mail, Outlook Kalender, Google Calendar, Gmail, Teams, WhatsApp, Signal, Google Keep, GitLab | Connectors that read, and write only on your click |
| Google Keep schreiben (beta) | Your Keep notes editable in Zeff — written back through Keep's own editor, on your click |
| Roar, TimO | The corporate timesheets: export and read back |
| Backups, Konten | Encrypted backups (daily, weekly, monthly); more than one account |

**Writes happen only on your click.** Sending a WhatsApp, Signal or Teams message, posting to Jira or
GitLab, exporting to Roar or TimO, writing a Keep note: each runs only from a button. The automatic
steps (syncs, the Lage, reviews, Auto-Aktionen) only read and propose. `tests/safety.test.ts`
enforces this. Every write tool has a fixed list of callers, and the automatic steps may not import
an action runner or a server-actions file.

## Connect an agent (MCP)

Each account has its own endpoint. **`/api/mcp` is always the first account's**, whichever account
the app is switched to. Other accounts are at `/api/mcp/<account id>`. The `/mcp` page lists them
with ready-to-paste config.

```bash
claude mcp add --transport http --scope user zeff http://127.0.0.1:9333/api/mcp
```

Tools: `report_time`, `list_jobs`, `list_projects`, `create_job`, `get_weekly_report`,
`list_time_entries`, `update_time_entry`, `delete_time_entry`. For todos: `list_todos`,
`start_todo`, `todo_context`, `todo_progress`, `todo_needs_input`, `finish_todo`, `complete_todo`.
For knowledge: `search_knowledge`. The server's instructions tell the agent how to book: one short
line, honest hours, and a suggestion for you to take over.

Set `ZEFF_MCP_TOKEN` in `.env.local` to require `Authorization: Bearer <token>`. Without it the
endpoint is open, which is fine on localhost.

## The knowledge server (`knowledge/`)

This is a Next app of its own, one per account (the launcher starts them). It reads Confluence
spaces, a folder of exported pages, Google Keep, and Zeff's own data. Zeff's data covers tickets
with their comments, Teams and WhatsApp chats, mail, merge requests, todos, time entries, notes and
facts. It compiles each page once per version with the account's AI (summary, concepts, entities,
relations) and answers searches and questions. Zeff reaches it through
`src/plugins/knowledge/client.ts`. Its own Plugins page chooses the sources, the AI and reading by
itself.

## The browser drivers

Gmail, WhatsApp, Keep, Teams, Outlook, GitLab, Roar and TimO are read (and, on a click, written)
through their web apps. Each driver is a small MCP stdio server in `src/plugins/<id>/driver.mjs`.
It runs from source and attaches over CDP to the account's automation Chrome (first account: port
9222, others: 9231 and up). "Chrome" is any Chromium browser: `scripts/browser-find.mjs` finds Google
Chrome, else Microsoft Edge, Brave or Chromium on Windows, macOS and Linux (`CHROME_PATH` overrides) and
starts it with its own profile (`ZEFF_CHROME_PROFILE`, else `roar-chrome-profile` in Zeff's user folder). It holds a per-app tab lock and can be stopped mid-sync. Sign-ins are
yours: Zeff asks for one (Logins page, notifications) and never signs in itself. A sync that keeps
failing (twice in a row, or for 12 hours) shows on **Heute**, with the reason: sign-in needed, the
automation Chrome not running, or the page changed.

Signal has no web app: its driver (`src/plugins/signal/driver.mjs`, beta) attaches over CDP to
Signal Desktop itself, started with `--remote-debugging-port=9339` (Zeff starts it so, and the
Signal page can add the port to Signal's autostart entry). It reads through Signal's own chat
objects in its window's isolated world — no chat opened, nothing marked read — and never touches
Signal's encrypted database.

## Import meetings from Outlook / Teams

Calendar access through OAuth is usually blocked by the tenant (admin consent), and New Outlook has
no local API. So Zeff reads the calendar where you're already signed in:

- **Automation Chrome** (Outlook Kalender plugin): the sync reads the weeks around now into the
  meeting inbox.
- **Bookmarklet**: on `/import`, drag "📅 Zeff: import meetings" to the bookmarks bar. Click it in
  Outlook's week view; the week's meetings open in Zeff (as a URL fragment, posted same-origin to
  `/api/calendar/ingest`). There's a copy & paste fallback for blocked popups.
- **Microsoft Graph** (device code, or `MS_CLIENT_ID` / `MS_TENANT_ID`) where the tenant allows it.
  `ZEFF_CALENDAR_FIXTURE=./fixtures/calendar-example.json` works offline.

Meetings become entries rounded to quarter hours. A ticket key in the subject becomes the ticket,
and job and exclude rules apply. A meeting is never booked twice (its event id is stored).

## Jira

The Jira plugin syncs your tickets, and the chosen boards' tickets, **without an LLM**. It calls
your Jira MCP stdio server directly: a `jira` or `mcp-atlassian` entry in `.mcp.json`, or
`JIRA_MCP_COMMAND` and the related variables (see `.env.example`). A ticket can be linked to a job,
and booking that ticket then uses that job. Analysis shows cycle time, throughput and tickets
closed per week.

## Project layout

```
src/
  app/                 pages (App Router), API routes, Zeff's own server actions (actions.ts)
    action-helpers.ts  what the server actions share (forms, revalidation, ActionState)
    api/mcp/           the MCP endpoints (/api/mcp, /api/mcp/<account>)
  plugins/<id>/        a plugin: its manifest entry (catalog.ts), driver.mjs, server-actions.ts,
                       the client-safe catalog of a todo's operations (actions.ts), run.ts, UI
  lib/                 the core: entries, week math, schedule, boards (the Lage), work, sync, mail …
  mcp/                 the MCP tools (server.ts) and the per-account HTTP handler (http.ts)
  db/                  Drizzle schema, the connection, accounts (one database each)
knowledge/             the knowledge server (its own Next app)
launcher/              the Electron launcher (supervisor, HTTPS proxy, tray)
scripts/               deploy, dist, seed, the Chrome/CDP helper, driver shims
tests/                 npm test (node:test + tsx), each file on a temporary database
drizzle/               SQL migrations
data/                  the databases, backups, logs (git-ignored)
```

## Notes

- Weeks are ISO weeks (Monday–Sunday). Dates are stored as `YYYY-MM-DD` in the server's local time.
- Hours are decimals (`0.25` = 15 min), and one entry may not exceed 24 h.
- A job can only be deleted while no time is booked on it. Deactivate it instead.
- The web UI has no login. Run it on localhost (the launcher binds 127.0.0.1).
