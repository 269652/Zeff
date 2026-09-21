# Zeff — Zeiterfassung

Hourly time reports for job numbers, with a built-in **MCP server** so a coding agent
(Claude Code, Cursor, Claude Desktop, …) can book the time it spent on a ticket by itself.

- **Weekly report** — hours per job and weekday (Mon–Sun), totals, all entries of the week,
  filter by reporter, CSV export.
- **Jobs** — the job numbers time is booked on (create, edit, deactivate).
- **MCP server** at `/api/mcp` — `report_time`, `list_jobs`, `create_job`,
  `get_weekly_report`, `list_time_entries`, `update_time_entry`, `delete_time_entry`.
- **Local SQLite** database (`data/zeff.db`), created and migrated automatically on first start.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 · Drizzle ORM + better-sqlite3 ·
`mcp-handler` 2 / MCP SDK v2 (Streamable HTTP, stateless).

## Getting started

```bash
npm install
npm run db:seed   # optional: three example jobs
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
> (job 2026-0815, reportedBy "Claude Code", ticket = the JIRA key).

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
| `npm run db:seed`     | Create example jobs (only if there are none)              |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` (applied automatically at startup) |
| `npm run db:studio`   | Browse the database with Drizzle Studio                   |

## Project layout

```
src/
  app/
    page.tsx              weekly report (/?week=2026-W39&by=name)
    jobs/                 job list, /jobs/[id] edit + entries
    entries/[id]/         edit a single entry
    mcp/                  connection instructions
    api/mcp/route.ts      MCP endpoint (Streamable HTTP)
    api/report/route.ts   CSV export for a week
    actions.ts            server actions used by the forms
  mcp/server.ts           MCP tool definitions
  lib/                    week math, validation, jobs + entries data access
  db/                     Drizzle schema + SQLite connection (auto-migrates ./drizzle)
drizzle/                  generated SQL migrations
data/zeff.db              the database (git-ignored)
```

## Notes

- Weeks are ISO weeks (Monday–Sunday); dates are stored as `YYYY-MM-DD` in the server's local time.
- Hours are decimals (`0.25` = 15 min); one entry may not exceed 24 h.
- Deleting a job is only possible while no time is booked on it — deactivate it instead.
- The web UI has no login; run it on localhost or behind your own auth/reverse proxy.
