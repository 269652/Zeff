# Entities: organisations, projects, places

The plugin `entities` ("Organisations, projects & places", `src/plugins/entities/`) gives Zeff the nodes besides people that
correlations need, each known under every name the sources use. It builds on People (identity resolution, the graph) and the
Workspace, and follows People's rules: deterministic candidates, **review-first** proposals (never merged or created by itself),
a rejected proposal is remembered.

## Refs

| Ref | What | Where it lives |
| --- | --- | --- |
| `org:<id>` | an organisation | `ent_entities` (kind `org`) |
| `place:<id>` | a place (an address, a room, "Büro") | `ent_entities` (kind `place`) |
| `project:<id>` | a project — the time tracking's (`src/lib/projects.ts`) | `projects` |

What an entity is known by and linked to is in `ent_links (ref, rel, target, label, evidence, source)`, one row per
(entity, rel, target):

| rel | target | e.g. |
| --- | --- | --- |
| `alias` | another name | `Büro`, `Acme GmbH` |
| `domain` | an organisation's registrable mail domain | `example.com` |
| `job` | a job number (besides the project's own job) | `AB123-000001-00` |
| `jira` | a Jira project key | `PROJ` |
| `board` | a Jira board id | `3359` |
| `repo` | a repo id (`repos`) | `2` |
| `db` | a Workspace database (page id) | `26` |
| `org` | the organisation a project is for | `org:4` |

People are linked through the people graph (`people_links`, source `rule`, confirmed): `works-at` → `org` (an address of
theirs at the organisation's domain, or a role claim naming it), `located-at` → `place` (their address in their details).
`target_ref` is the entity's id, `label` its name.

## The resolver — `src/plugins/entities/resolve.ts`

```ts
import { resolveEntity, resolveRefs, projectOf } from "@/plugins/entities/resolve";

resolveEntity("anna.weber@example.com"); // [{ ref: "person:4", kind: "person", via: "email" }, { ref: "org:2", kind: "org", via: "domain" }]
resolveEntity("example.com");            // [{ ref: "org:2", … via: "domain" }]
resolveEntity("Acme GmbH");           // [{ ref: "org:2", … via: "name" }]   (legal forms ignored)
resolveEntity("Büro");                     // [{ ref: "place:7", … via: "alias" }]
resolveEntity("PROJ-12");                   // [{ ref: "project:3", … via: "ticket" }]
resolveRefs("friend@gmail.com");           // []  (freemail is no organisation)

projectOf("ticket:PROJ-12");  // "project:3" — the ticket's board's project, else its job's, else the one project with key PROJ
projectOf("entry:812");      // the entry's project, else its job's
projectOf("job:AB123-000001-00");
projectOf("todo:55");        // its ticket's
projectOf("repo:2");
projectOf("mr:customer-proj/proj-frontend!17"); // via the repo of that GitLab project
projectOf("page:26");        // a database linked to a project, or a row of one
```

- **Exact matches only** (as normalized): names folded (case, umlauts, spaces); organisations without legal forms
  (`normalizeOrgName`); addresses with `str.` = `straße` and without commas (`normalizeAddress`). A guess is no resolution.
- An address resolves to its person *and* the organisation of its domain; a domain only to an organisation; freemail
  (gmail, gmx, web.de, outlook, icloud, …: `isFreemail`) never to one.
- A Jira key alone resolves a ticket only when exactly one project has that key (PROJ may be two jobs — then the ticket's board
  decides).
- Server only; it reads the tables directly and is cheap enough to call per record (no AI).

## Proposals — `src/plugins/entities/suggest.ts`

`findEntitySuggestions()` (no AI) queues into `ent_suggestions`; the review queue (`/review`, source `entities`) and
`acceptEntitySuggestion` / `rejectEntitySuggestion` decide them. Kinds:

- `org` — a mail domain with two mails or more (or an address of a profile, or one you answered), a People profile that is an
  organisation, a job's or project's customer, a bank counterparty with a legal form (GmbH, AG, Bank, Sparkasse …), a role
  claim "… bei X". Candidates of one domain or one normalized name are one proposal.
- `place` — appointment locations (calls and links never; two appointments, or an address with a post code), people's
  addresses, addresses in documents. A shorter way of writing an address waits until the long one exists, then becomes an
  `alias` proposal.
- `project` — a job (active, not the placeholder) that has a Jira board, tickets or a repo and no project yet: the project with
  its job, keys, boards, repos, board databases and customer. Accepting creates the time-tracking project.
- `alias`, `link` (missing domains of an organisation; boards, keys, repos, databases of an existing project), `merge` (two
  organisations with one domain or name, two places with one address).

It runs when an entity database is read (the pipeline) and with People matching (`peoplenorm`, after the briefing).
`deriveEntityLinks()` then adds the `works-at` / `located-at` links.

## In the UI

- Three Workspace databases, made once while the plugin is installed: **Organisations**, **Projects**, **Places**
  (sources `orgs`, `projects`, `places`, `workspace-source.ts`). Two-way like People: title, aliases, domains, address, note
  edited in a row go to the entity; a row of your own makes one. A row's page gathers (`detail.ts`): an organisation's people,
  projects, tickets, latest mails and money paid/received; a place's people and appointments; a project's job, keys, boards,
  repos, databases, booked hours, open tickets and latest entries.
- The review queue: "Organisations, projects and places".

## MCP

- `entity_search { query, kind?, limit? }` — by name, other name, domain, mail address, ticket key, job number, address.
- `entity_get { ref }` — an entity with its links, people and what it gathers; any other ref (`ticket:…`, `entry:…`, `todo:…`,
  `mr:…`) reads the project it belongs to.

Both are also in the Workspace chat. Not done yet: `@`-mentions and hover cards for entities.
