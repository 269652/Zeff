# Zeff

Zeff started as a *Zeiterfassung*: hourly time reports on job numbers, with an MCP server so a
coding agent can book the time it spent on a ticket. It has grown into a local work assistant
around that core:

- **Time tracking.** Entries on jobs and projects, working hours, absences, flex time, a weekly
  and a monthly report. Every agent booking arrives as a suggestion that you take over.
  *Feierabend* books the whole day in one go. Exports go to **Chrono** and **Punch**.
- **Todos and the Ticket-Lage.** An AI pass over your Jira tickets, mail, chats and merge requests
  says what happened and what's to do. Its todos carry their context, due dates and ready-made
  actions. **Heute** is the day on one page.
- **Connectors.** Jira, Outlook mail and calendar, Gmail, Teams, WhatsApp, Google Keep and GitLab.
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
```

The database is created and migrated on first start (`drizzle/`). After editing
`src/db/schema.ts`, run `npm run db:generate`.

## Plugins

| Plugin | What it is |
| --- | --- |
| Zeiterfassung, Wochenbericht, Monatsbericht | Jobs and projects, working hours and absences, booking, the week and the month |
| Todos, Tickets | The Ticket-Lage, todos with their context, activity and recap; the Lage per ticket |
| Kanban, Jira Lage | Your own boards; your Jira boards with each card's Lage |
| Work | Agents on your todos: runs, live sessions, repos, delivery |
| Auto-Aktionen | Ready-made actions for every open todo, from what the installed plugins can do |
| LLM, Copilot CLI, Claude CLI | The AI layer: a backend and model per task, your instructions |
| Knowledge | The knowledge server's chat, and "Show knowledge" on todos |
| Jira, Outlook Mail, Outlook Kalender, Gmail, Teams, WhatsApp, Google Keep, GitLab | Connectors that read, and write only on your click |
| Chrono, Punch | The corporate timesheets: export and read back |
| Backups, Konten | Encrypted backups (daily, weekly, monthly); more than one account |

**Writes happen only on your click.** Sending a WhatsApp or Teams message, posting to Jira or
GitLab, exporting to Chrono or Punch, writing a Keep note: each runs only from a button. The automatic
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

Gmail, WhatsApp, Keep, Teams, Outlook, GitLab, Chrono and Punch are read (and, on a click, written)
through their web apps. Each driver is a small MCP stdio server in `src/plugins/<id>/driver.mjs`.
It runs from source and attaches over CDP to the account's automation Chrome (first account: port
9222, others: 9231 and up). It holds a per-app tab lock and can be stopped mid-sync. Sign-ins are
yours: Zeff asks for one (Logins page, notifications) and never signs in itself. A sync that keeps
failing (twice in a row, or for 12 hours) shows on **Heute**, with the reason: sign-in needed, the
automation Chrome not running, or the page changed.

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
