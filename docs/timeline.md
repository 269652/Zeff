# The timeline

One event log of what happened across Zeff's sources, each event tied to the entities it concerns. The plugin is
`timeline` (`src/plugins/timeline/`, installed by default). It answers "what happened with X?" and "what changed since
I last looked?" — for the pages, for agents (MCP) and for other plugins (API, or in-process imports).

Events are small pointers: a title, a short summary, a link and refs. **The source tables stay the truth** — read the
mail, the ticket, the row itself when you need more than the event says.

## The model

```
tl_events      (id, at, kind, source, source_ref, title, summary, actor_ref, url, data json)   unique (source, source_ref)
tl_event_refs  (event_id, ref)                                                                  index (ref, event_id)
tl_seen        (ref, at)        when you last looked at a ref's timeline ("all": the Timeline page)
tl_marks       (source, mark)   how far the indexer read each source
tl_ticket_state(key, status, updated_at)   what the indexer saw last of each Jira ticket (status changes)
```

Tables are made on first use (no drizzle migration).

- `at` — ISO UTC. Appointments are at their start (may lie in the future), time entries at their day (and start).
- `kind` — what happened; filters match a kind or its prefix (`todo` = `todo.created`, `todo.done` …).
- `source` — where it came from. `source_ref` — its id there; recording the same `(source, source_ref)` again changes
  nothing (`recordEvent` is idempotent).
- `actor_ref` — who did it, as a ref, when known (the sender, the commenter); empty for you or unknown.
- `refs` — the entities it concerns (below). Its own identity is a ref too (`mail:<key>`, `msg:<source>:<id>` …).

### Refs (the shared model)

`person:<id>` · `ticket:<KEY>` · `todo:<id>` · `page:<id>` (a Workspace page or row — cases are rows) · `project:<id>` ·
`job:<number>` · `org:<id>` · `place:<id>` · `mail:<emails.key>` · `msg:<whatsapp|signal|teams>:<key>` ·
`event:<calendar_events.id>` · `doc:<documents.id>` · `entry:<time_entries.id>`

Refs are normalized by `normRef` (ticket keys upper-case). `WS-<n>` keys become `page:<n>`.

### Kinds and sources

| kind | source | refs (besides people and ticket keys found in the text) |
| --- | --- | --- |
| `mail` | `mail` | `mail:<key>`, the sender by address or name |
| `message` | `whatsapp`, `signal`, `teams` | `msg:<source>:<key>`, the chat's owner (its name), the sender |
| `ticket.created`, `ticket.status`, `ticket.updated` | `jira` | `ticket:<KEY>`, the assignee; `data.from` / `data.status` on a status change |
| `comment` | `jira` | `ticket:<KEY>`, the author (name or Jira username) |
| `mr.opened`, `mr.merged`, `mr.closed`, `mr.comment` | `gitlab` | ticket keys in title / branch, the author |
| `meeting` | `calendar` | `event:<id>`, attendees and organizer (address or name); cancelled ones are left out |
| `time` | `time` | `entry:<id>`, `ticket:`, `project:`, `job:` |
| `todo.created`, `todo.done`, `todo.dismissed`, `todo.reopened`, `todo.merged` | `todos` | `todo:<id>`, its ticket |
| `row.added`, `row.changed` | `workspace` | `page:<row>`, `page:<database>`, the person / case / ticket the row stands for; a day's changes of a row are one event (`data.fields`: field → new value) |
| `payment` | `bank` (Finances installed) | the case's row (`page:`), the counterparty as a person |
| `document` | `documents` | `doc:<id>`, people by their address or name in the text |

People are resolved by rule (`refs.ts` `makeResolver`): mail addresses, names, aliases, WhatsApp chat names, Jira
usernames — a form two people share names neither — plus the names a text mentions (`people/mentions.ts`). Ticket keys
count when their project is one Zeff knows (Jira tickets, comments, todos). Workspace changes written by a source
(pipelines, routines reading records) are not events — the source's own events are.

## Writing

- `recordEvent(input, { merge? })` → `{ id, created }` — `store.ts`. `merge`: an existing event takes the new title,
  summary, time and data, and the new refs are added.
- The indexer (`indexer.ts`) — `indexTimeline({ batch?, maxBatches?, only? })` reads each source after its mark,
  bounded (500 rows × 4 batches a source a run), and runs after every sync step (`lib/sync/registry.ts` `runStep`) and on
  the scheduler's minute tick (`lib/sync-scheduler.ts`). No AI. `backfillTimeline({ rounds?, fromScratch? })` reads
  everything in bounded runs (`fromScratch`: marks reset; recorded events stay).
- A new source: add a `Source` to `SOURCES` in `indexer.ts` (mark by time+key with `byTime`, or by id with `byId`).
  Wave-2 features that create their own events (an open loop closed, a question answered) can call `recordEvent`
  directly with a `source` of their own.

## Reading

In-process (server only):

```ts
import { eventsFor, eventsBetween, eventCounts, changesSince, lastSeen, markSeen } from "@/plugins/timeline/store";
eventsFor("person:12", { since, until, kinds: ["mail", "todo"], sources, limit, before })   // newest first; a ref or a list of refs
eventsBetween(fromIso, toIso, { kinds, sources, refs, limit })
eventCounts("ticket:PROJ-7", { since })            // { total, byKind, last }
changesSince(iso, { kinds, sources, refKinds, limit, perGroup })   // [{ ref, count, last, kinds, events }] busiest first

import { timelineFor, timelineSince, parseSince } from "@/plugins/timeline/query";
timelineFor({ ref | q | row, since: "7d", kinds, limit })   // resolves names; events with labelled `entities`
timelineSince({ since: "2026-10-01" })                       // groups with label + href

import { resolveQuery, labelOf, hrefOf, refsOfRow, makeResolver } from "@/plugins/timeline/refs";
```

`parseSince` takes `24h`, `7d`, `2w`, `1m`, a day (`YYYY-MM-DD`, local midnight) or an ISO time.

Plugin API (permission `timeline.read`): `timeline.for`, `timeline.since` — see `docs/plugins/api.md`.

MCP (agents; in the "Search what Zeff knows" tool group): `timeline_for { ref, since?, until?, kinds?, sources?, limit? }`
and `timeline_since { since, until?, kinds?, sources?, refKinds?, limit?, perGroup? }` — answers as lines
`YYYY-MM-DD HH:MM | kind (source) | title — summary | Label [ref], … | url`.

## UI

- The Timeline page `/timeline`: filters by kind and source, an entity (`?ref=` a name or ref), "since your last
  visit" by entity beside it, the line of your last visit in the list.
- A page block `:::block timeline {"ref":"person:3","limit":20}` (slash menu "Timeline"); no ref: the page's own (a
  row: the row, the person or case it stands for, the ticket it names); `"all"`: everything.
- A detail module `timeline` (rows of Jira databases show it by default; any database can add it).
- Parts of the person page (`person.timeline`) and the case page (`case.timeline`).
- `ui/TimelineList.tsx` (reads itself, `entity` / `row` / neither) and `ui/TimelineView.tsx` (draws given events).
