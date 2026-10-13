# The sync host

One Zeff, two servers — so a deploy of the pages doesn't cut off a sync.

| | web (`ZEFF_ROLE=web`, :9333) | sync host (`ZEFF_ROLE=sync`, :9336) |
|---|---|---|
| pages, server actions, MCP, work runs, live sessions | ✔ | |
| the syncs of the sync menu, the scheduler (Jira, mail, Teams, GitLab, Keep, news, calendars …) | | ✔ |
| the Ticket-Lage and the steps behind it (mail/note/document reviews and relations, knowledge, people, auto actions) | | ✔ |
| the day recap, backups, calendar todos, Keep board sync, the search for people's dates | | ✔ |
| the database | the same SQLite file (WAL, `busy_timeout`) — both open it, as the knowledge server and the work host already do | |

Without a host (`ZEFF_ROLE` unset: dev, tests, a launcher without the host build) one server does everything, as before.

## How they talk

- **web → host**: `POST /api/sync-host { op, args, account }` with `Authorization: Bearer <ZEFF_SYNC_TOKEN>` (`src/lib/host/ops.ts` lists the operations). The host runs it in the account the web server was in. A host that is down is *said* so (“The sync server isn't answering”) — nothing is started on the side.
- **host → web**: what the host is doing lives in its memory (`globalThis.__zeff…`). The web server copies exactly the fields in `MIRRORED_FLAGS` (`src/lib/host/mirror.ts`) into the same fields of its own memory every 1.5 s, and at once when the host posts `/api/host-event` — so every page, the sync menu and the account switch read them unchanged. Changes (`emitChange`) go the same way, so open pages refresh.
- **deploy**: `npm run deploy` builds once, gives the host its own copy (`.next-sync-build` → `.next-sync`, swapped only when the host has nothing to do), and restarts the pages. A briefing or sync running on the host doesn't hold the pages' deploy back (`scripts/deploy.mjs`: `syncHost()`).
  - first time: `npm run deploy -- --sync` (the launcher must be restarted once so it knows the `Sync` service)
  - host busy: its new build waits; `npm run deploy -- --sync-only` takes it over later (or `--sync` waits for it)
  - `--no-sync` leaves the host alone.

## What to keep in mind when writing code

- Something that takes long and keeps state in memory (`globalThis.__zeffX`) runs through the host: start it with an op in `ops.ts` and a `…Anywhere` command in `commands.ts`, and add its field to `MIRRORED_FLAGS` if pages read it.
- Pages and actions must not call a sync function directly any more: through the registry (`startSync`, `syncAndWait` …) — they answer for the host when there is one.
- Everything the host does is in a `withAccount(…)` scope; the host re-reads `data/accounts.json` (`reloadAccounts`) because the web server writes it when you switch.
- Protocol changes: additive, so a web server and a host from two deploys still understand each other (the host's build may be a deploy behind).
