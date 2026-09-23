# Zeff — Zeiterfassung

Hourly time reports for job numbers, with a built-in **MCP server** so a coding agent
(Claude Code, Cursor, Claude Desktop, …) can book the time it spent on a ticket by itself.

- **Weekly report** — hours per job and weekday (Mon–Sun), totals, all entries of the week,
  filter by reporter, CSV export.
- **Jobs** — the job numbers time is booked on (create, edit, deactivate).
- **Entry types, tags & report** — each entry is a Ticket / Meeting / Other; #tags in a description
  autocomplete and become tags (managed on the Tags page); the weekly **Report** view groups per day
  (meetings collapsed into one line, tickets as `KEY: description`), configurable by ticket / type / tag.
- **Working hours & absences** — a weekly part-time pattern (e.g. free Fridays) and one-off vacation/
  sick/holiday, so the weekly report shows booked hours against your target.
- **Jira** — a local, syncable copy of your assigned tickets, pulled from your Jira MCP server with
  no LLM. Populates the ticket autocomplete, links tickets to jobs, and tracks completion (tickets
  closed per week) in Analysis.
- **Import meetings** — pulls the finished meetings of a week from your Outlook / Teams calendar
  (via a no-OAuth browser bookmarklet, or Microsoft Graph where allowed) into a preview where you
  pick the job, then books them as time entries.
- **MCP server** at `/api/mcp` — `report_time`, `list_jobs`, `create_job`,
  `get_weekly_report`, `list_time_entries`, `update_time_entry`, `delete_time_entry`.
- **Local SQLite** database (`data/zeff.db`), created and migrated automatically on first start.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 · Drizzle ORM + better-sqlite3 ·
`mcp-handler` 2 / MCP SDK v2 (Streamable HTTP, stateless).

## Getting started

```bash
npm install
npm run db:seed   # creates the known job numbers (see scripts/seed.ts)
npm run dev       # http://localhost:3000
```

The database file and schema are created on first request — there is no separate migrate step.
Copy `.env.example` to `.env.local` to change the database path or protect the MCP endpoint.

## Connect an agent

Open **http://localhost:3000/mcp** in the app — it shows the endpoint URL and ready-to-paste
config for your setup. For Claude Code:

```bash
claude mcp add --transport http --scope user zeff http://localhost:3000/api/mcp
```

or per project in `.mcp.json`:

```json
{
  "mcpServers": {
    "zeff": { "type": "http", "url": "http://localhost:3000/api/mcp" }
  }
}
```

Stdio-only clients can bridge with `npx -y mcp-remote http://localhost:3000/api/mcp`.

Then, when an agent has finished a ticket, it calls `report_time`:

```json
{
  "jobNumber": "2026-0815",
  "hours": 1.5,
  "description": "Implemented CSV export, added tests",
  "ticket": "PROJ-337",
  "reportedBy": "Claude Code"
}
```

`date` defaults to today. Unknown job numbers are rejected with suggestions, so the agent
should call `list_jobs` first (the server's MCP instructions tell it to). To make reporting
automatic, add a line like this to the project's `CLAUDE.md`:

> After finishing a ticket, book the time spent with the Zeff `report_time` tool
> (job 2026-0815, reportedBy "Claude Code", ticket = the JIRA key) using a concise
> one-line description — no commit logs or file lists.

## Import meetings from Outlook / Teams

The `/import` page turns finished calendar meetings into time entries: subject -> description,
duration rounded to quarter hours, a JIRA-style key in the subject (`PROJ-337`) -> ticket, one job
for all (or per row). All-day, cancelled and declined meetings and anything still in the future are
skipped; meetings imported before are marked and cannot be booked twice (the calendar event id is
stored on the entry).

### Bookmarklet bridge (no OAuth, no admin — the primary method)

Many tenants block app-based calendar access (OAuth / Microsoft Graph) at the admin-consent level,
and "New Outlook" has no local API. So Zeff reads the calendar through the browser session you are
already signed in to, with a one-click bookmarklet:

1. Open `/import` and drag **📅 Zeff: import meetings** to your bookmarks bar (once).
2. Open [outlook.office.com](https://outlook.office.com/calendar/view/week) in **Week view**, pick a
   week, and click the bookmark. It reads that week's meetings from the page and opens Zeff with them
   (the data rides in the URL fragment; the server ingests it same-origin at `POST /api/calendar/ingest`).
3. Review and book. Repeat per week. **Clear** empties the inbox.

Nothing leaves your machine and no credentials are handled — the browser already has the session, and
only calendar event labels (subject/time/organizer) are read.

If your browser blocks the popup, use the **copy & paste** fallback on the same page: the copy
bookmarklet puts the meetings on your clipboard and you paste them into Zeff's box.

### Other sources

- **Fixture:** `ZEFF_CALENDAR_FIXTURE=./fixtures/calendar-example.json` serves Graph-shaped events
  from a file — the whole flow works offline against the sample week.
- **Microsoft Graph (if your tenant allows it):** the `/import` page also offers device-code sign-in
  via Microsoft's public Graph client, and browser-redirect sign-in when you set `MS_CLIENT_ID` /
  `MS_TENANT_ID` for your own Entra app. Both need delegated `Calendars.Read`; where admin consent is
  required they will say so, and the bookmarklet is the fallback.

### Protecting the endpoint

Set `ZEFF_MCP_TOKEN` in `.env.local`; clients must then send
`Authorization: Bearer <token>` (Claude Code: `--header "Authorization: Bearer <token>"`).
Without a token the endpoint is open, which is fine on localhost.

## Scripts

| Script                | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run dev`         | Dev server with Turbopack                                 |
| `npm run build/start` | Production build / server                                 |
| `npm run typecheck`   | `tsc --noEmit`                                            |
| `npm run lint`        | ESLint                                                    |
| `npm run db:seed`     | Create the known job numbers from `scripts/seed.ts` (skips existing) |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` (applied when the server next starts — restart `npm run dev`) |
| `npm run db:studio`   | Browse the database with Drizzle Studio                   |
| `npm run serve`       | Production server on 127.0.0.1:9333 (after `npm run build`) |
| `npm run autostart:install` | Start Zeff automatically on Windows login (see below) |
| `npm run autostart:uninstall` | Remove the login autostart                          |
| `npm run autostart:status`  | Show autostart + server status                        |

## Project layout

```
src/
  app/
    page.tsx              weekly report (/?week=2026-W39&by=name)
    jobs/                 job list, /jobs/[id] edit + entries
    entries/[id]/         edit a single entry
    settings/             working hours, absences & report rewriting
    tags/                 tag management
    jira/                 synced Jira tickets
    analysis/             analytics dashboard
    mcp/                  connection instructions
    import/               meeting import preview (Outlook / Teams via Microsoft Graph)
    api/calendar/         OAuth connect + callback + ingest (bookmarklet) routes
    api/mcp/route.ts      MCP endpoint (Streamable HTTP)
    api/report/route.ts   CSV export for a week
    actions.ts            server actions used by the forms
  mcp/server.ts           MCP tool definitions
  lib/                    week math, validation, jobs + entries data access
  lib/calendar/           Graph client, OAuth/PKCE, meeting → entry planning
  lib/jira/               Jira MCP stdio client, sync, normalize, store
fixtures/                 example calendar events for ZEFF_CALENDAR_FIXTURE
  db/                     Drizzle schema + SQLite connection (auto-migrates ./drizzle)
scripts/                  seed, and Windows autostart (autostart.ps1, zeff-serve.ps1)
drizzle/                  generated SQL migrations
data/zeff.db              the database (git-ignored)
```

## Working hours & absences

Open **Schedule** (`/settings`) to set your weekly working pattern and record time off:

- **Weekly hours** — expected hours per weekday. Set a day to 0 to make it non-working, e.g. free
  Fridays for an 80% week. The total shows your weekly target.
- **Absences** — vacation, sick, holiday or other, over a date range. A full-day absence zeroes that
  day's target; set *Hours/day* for a partial day.

The weekly report then shows **Booked / Target / Remaining** (Remaining turns to *Overtime* when you
go over), a **Target** row per weekday, and marks non-working and absence days in the day headers.

## Types, tags & the report

- **Type** — every entry is `ticket`, `meeting` or `other`. Calendar imports are always meetings;
  entries with a ticket key default to ticket. It drives report grouping.
- **Ticket → job memory** — once a ticket is booked on a job, booking it again (including the MCP
  `report_time` tool with no jobNumber) reuses that job. The ticket field autocompletes with the
  week's tickets and auto-selects the job.
- **Tags** — manage on **/tags**, or type `#tag` in a description: an autocomplete pops up, and on
  confirm the `#tag` is removed from the text and added as a tag. Works via MCP too (`#tags` in the
  description are extracted server-side).
- **Report** (weekly page) — a per-day grouped, copy-ready view. Configure grouping on **Schedule →
  Report rewriting**: by ticket/meeting (meetings → one “Meetings” line, tickets → `{ticket}: {description}`),
  by type, or by tag. Grouped lines are expandable to the underlying entries.

$anchor

Make the server start on login (production build, http://127.0.0.1:9333), no admin needed:

```bash
npm run build            # once, and after code changes
npm run autostart:install
npm run autostart:status
```

`autostart:install` registers a per-user Scheduled Task **“Zeff Server”** that runs
`scripts/zeff-serve.ps1` hidden; it launches `next start` and restarts it if it ever exits
(log: `data/autostart.log`). The task fires on **log on, session unlock and console connect** — so it
also starts after a Windows **Fast Startup** resume, where a plain Startup-folder shortcut does *not*
re-run (that was the old, unreliable mechanism). It launches the watchdog detached (via Task
Scheduler), so it survives closing your terminal. Start/stop it now without rebooting via
`scripts\autostart.ps1 -Start` / `-Stop`, and remove it with `npm run autostart:uninstall`. Because it
serves a production build, run `npm run build` again after changing code (then `-Stop` and `-Start`).

## Jira

The **Jira** tab keeps a local copy of your assigned tickets and drives ticket autocomplete,
ticket→job memory, and the completion metrics in Analysis.

- **Sync** calls your Jira MCP server **directly, without an LLM** (a plain MCP stdio client). Zeff
  auto-reads a `jira` (or `mcp-atlassian`) stdio server from `.mcp.json` and loads its `envFile`, so
  if that server works for your editor it works here — e.g. `uvx mcp-atlassian` with `JIRA_URL` +
  `JIRA_PERSONAL_TOKEN` in `.env`. Override with `JIRA_MCP_COMMAND` / `JIRA_JQL` etc. (see `.env.example`).
  First sync is slow (~30s) while `uvx` starts the server.
- **Paste import** is a fallback that needs no server: paste an array of issues or `{"issues":[…]}`.
- Each ticket can be linked to a **job**; selecting that ticket in the entry form then auto-fills the job.
- Analysis uses ticket status + resolution date to report **tickets closed per week** and a done/open
  breakdown (tickets resolved without a resolution date aren’t counted per week).

## Notes

- Weeks are ISO weeks (Monday–Sunday); dates are stored as `YYYY-MM-DD` in the server's local time.
- Hours are decimals (`0.25` = 15 min); one entry may not exceed 24 h.
- Deleting a job is only possible while no time is booked on it — deactivate it instead.
- The web UI has no login; run it on localhost or behind your own auth/reverse proxy.
