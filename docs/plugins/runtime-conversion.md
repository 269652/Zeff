# Turning the built-in plugins into runtime plugins

Goal: every plugin of Zeff lives in the `zeff-plugins` repository as a runtime plugin, installed through `packages.json` and updated
from there ([repository.md](repository.md)) — no rebuild of Zeff for a plugin.

## The rule: composed from Zeff's own kit

A plugin rewritten or extracted for this is **composed from Zeff's building kit**, as Learn is — not its old React and server code
ported into an iframe:

- its data in **Workspace databases** (a package: `*.package.json` — databases, pages, views),
- what it shows as **views and blocks in the view language** (templates, `<use block=…>`, parts),
- what it does as **flows** and small **functions** (`fn/*.js`, sandboxed), schedules, chats.

So the AI can read and change any of it while Zeff runs — a view, a block, a flow, a function — and every change is versioned and
merged with the next update like any other ([repository.md](repository.md#merging-the-way-git-does)). Where the kit can't express
what a plugin needs, the kit grows (a generic piece), the plugin doesn't get special code.

## Where things stand (Nov 2026)

50 plugin manifests in `src/plugins/index.generated.ts`. Learn is converted and lives in `zeff-plugins/plugins/learn`. The rest,
by how far they are from today's runtime kinds:

- **fits now (2):** learn (done), lookups.
- **one or two new runtime capabilities (13):** lang-de, lang-es (and lang-en), agenda, browser, correlations, google-calendar,
  local-ai, mail-client, revolut, web-search; the three notebook kernels.
- **hard (35):** about 14 of them are Zeff's core and stay built in for now — workspace, studio, notebook (it runs the runtime
  plugins' functions), accounts, llm, todos, work (+ work-elevated), zeiterfassung, backup, the AI CLIs, calendar, timeline. The
  others (connectors, people, news, cases, finances, documents, knowledge-hub, loops, entities, jira-lage, auto-actions …) need
  several of the capabilities below.

## Capabilities the runtime still lacks (most plugins unblocked first)

| | Capability | Unblocks |
|---|---|---|
| K | ✅ **done** — i18n: a plugin ships its own strings (`contributes.locales`, a language pack: `contributes.language`); Learn brings its own (171 texts left Zeff's bundles) | the language packs; every conversion |
| A | ✅ **done** (`contributes.tools`, [manifest](manifest.md)) — a plugin's functions as Zeff's own MCP tools (Workspace chat, agents); a name Zeff has stays Zeff's | browser, web-search, correlations, entities, timeline, loops, gmail, imap … |
| B | ✅ **done** (`contributes.settings`) — a settings section with secrets (encrypted keys, never shown again), *needs setting up* on the card; its functions get them as `inputs.zeffSettings` | lookups, web-search, local-ai, connectors, news … |
| F | ✅ **done** (kernel stage 0, [the contract](../kernel-contract.md)) — Workspace extension points from functions: widgets, metrics, formula functions (a formula), row badges, tab menus, page navigation, review sources and links; every point is stored, covered, kernel or owner | correlations, mail-client, revolut, cases, people, finances … |
| C | schedules shown in the Sync menu (named step, interval, status, chained steps) | every connector, news, auto-actions |
| G | 🟡 **started** — views load a lambda's answer like a flow's (`<data name="x" lambda="…" with="…"/>`, read-only); still to do: the parts that are React today (Agenda's new-note form, mail-client's reader) as view language — a view kind of its own in the view language where today's views use React (parts, row templates) | agenda, mail-client, calendar, cases … |
| E | high-volume or indexed data beyond Workspace databases | the connectors' mail and message stores, timeline |
| D | a host-side driver (Playwright on the automation Chrome, a debug port) | the web-reading connectors |
| I | todo action types from a plugin | the connectors |
| H | named AI tasks (routing, editable prompt) | auto-actions, cases, people, news … |

## Order

1. ✅ lang-de / lang-es — language packs in zeff-plugins (`plugins/lang-de`, `plugins/lang-es`); Zeff has no German or Spanish of its own any more.
2. ✅ lookups — `plugins/lookups-ext`: its sources as lambdas (`contributes.lambdas`, no Notebook needed), its keys as encrypted settings; the built-in Lookups' tests pass against it (`tests/lookups-ext.test.ts`). The built-in stays until you switch (its keys are carried over then); not there yet: the *Try TMDB* button. ✅ web-search — `plugins/web-search-ext`: the search as a lambda that fills the kernel's **service** `web.search` (Brave or Google with your key, else the Claude login through the kernel's `ai.websearch`), `web_search` / `web_fetch` as tools with the built-in's names and texts, reading a page through the kernel's `web.read` (moved out of the plugin into `src/lib/web/`); the built-in's tests asked of the plugin pass (`tests/web-search-ext.test.ts`); *Switch to the plugin* on its settings page. ✅ browser — `plugins/browser-ext`: `browser_open` with the built-in's name and text; the automated Chrome stays Zeff's (a driver of the kernel, moved to `src/lib/web/browser.ts`), a plugin's lambda reaches it as `web.browse` only with the new **`browser` permission** you grant, only an address its lambda allows (`tests/browser-ext.test.ts`). Every built-in with a port offers *Switch to the plugin* on its card on the Plugins page (`src/plugins/ports.ts`). ✅ correlations — `plugins/correlations-ext`: the daily series became the kernel's (`src/lib/series`, `series.catalog` / `series.read`, the boundaries kept); the computing and the words are the built-in's own pure core (`src/plugins/correlations/core.ts`), bundled into the plugin's lambdas by `scripts/port-correlations.mts` with its German and Spanish texts — one source, the same sentences; lambdas know the user's language (`context.language`); the `correlations` tool and the widget (a port's widget takes over the built-in's id: `replaces`); the built-in's tool and widget tests pass against it (`tests/correlations-ext.test.ts`, `correlations-widget-ext.test.ts`). Not ported yet: the explore page (`/correlations`) — it stays Zeff's and works with the port (G). ✅ agenda — `plugins/agenda-ext`: a package generated from the built-in's template (`scripts/port-agenda.mts`), made in your language (`localize`); its screen the built-in's own made of the view language alone (`toPortScreen`: the sidebar from the lambda `agenda.data` through `<data lambda>`, the new-note form a `<dialog>` whose Save runs the package's flow `agenda.add-note` through the kernel's `db.add`); the switch turns your Agendas' screens (your changes kept). Kernel pieces it brought: `db.schema`, `db.query raw`, `db.add`, package flows writing their own databases (`@pkg.iN`), packages with two-way relations, `localizePackage`. Tested in `tests/agenda-ext.test.ts`. Not yet 1:1: a new Agenda's People field is a choice, not the People plugin's contacts; a new one has no calendar event field (one you switch keeps its own); the dialog doesn't preselect the project or *on the agenda* from where you are, and picks tags by typing. Next: mail-client (G); revolut needs an API of the built-in cases for its bank first.
3. mail-client and agenda (G + F), correlations (A + F), revolut (F).
4. google-calendar, local-ai.
5. The connectors, once E + C + D + I exist.
6. The big apps last — each rebuilt as a package + views + flows + functions, the way Learn was, not ported.
