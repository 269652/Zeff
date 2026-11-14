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
| C | ✅ **done** — a flow marked as a sync (`"sync": { label, what, replaces }`) is a step of the Sync menu: run there, its last run shown, its schedule trigger its interval (also on the Sync settings page, in the place of the built-in's step it replaces); a connector's driver is reached through a flow action only with the flow's `sync` permission (`gcal.sync`); a connector's built-in counts as there while its port is on (`PROVIDED_BY` in `src/plugins/state.ts`) — its settings, actions and Google's write access keep working — but its own sync step doesn't run | every connector, news, auto-actions |
| G | ✅ **done** — views load a lambda's answer like a flow's (`<data lambda>`), a plugin's pure code runs in the browser in a sandboxed frame (`<data compute>`, `contributes.compute`), buttons do the kernel's actions as you (`<button do>`, `<data do>` for reading and marking read), plugins bring screens for a type of database (`contributes.appViews`), `<suggested>` and `<know>` as elements; Mail & Chat's screens are view language alone | agenda, mail-client, calendar, cases … |
| E | high-volume or indexed data beyond Workspace databases | the connectors' mail and message stores, timeline |
| D | a host-side driver (Playwright on the automation Chrome, a debug port) | the web-reading connectors |
| I | todo action types from a plugin — not needed yet: the connectors' actions are defined with the kernel's calendar and mail code, and a port that provides its built-in (C) keeps them | the connectors that bring actions of their own |
| H | named AI tasks (routing, editable prompt) | auto-actions, cases, people, news … |

## Order

1. ✅ lang-de / lang-es — language packs in zeff-plugins (`plugins/lang-de`, `plugins/lang-es`); Zeff has no German or Spanish of its own any more.
2. ✅ lookups — `plugins/lookups-ext`: its sources as lambdas (`contributes.lambdas`, no Notebook needed), its keys as encrypted settings; the built-in Lookups' tests pass against it (`tests/lookups-ext.test.ts`). The built-in stays until you switch (its keys are carried over then); not there yet: the *Try TMDB* button. ✅ web-search — `plugins/web-search-ext`: the search as a lambda that fills the kernel's **service** `web.search` (Brave or Google with your key, else the Claude login through the kernel's `ai.websearch`), `web_search` / `web_fetch` as tools with the built-in's names and texts, reading a page through the kernel's `web.read` (moved out of the plugin into `src/lib/web/`); the built-in's tests asked of the plugin pass (`tests/web-search-ext.test.ts`); *Switch to the plugin* on its settings page. ✅ browser — `plugins/browser-ext`: `browser_open` with the built-in's name and text; the automated Chrome stays Zeff's (a driver of the kernel, moved to `src/lib/web/browser.ts`), a plugin's lambda reaches it as `web.browse` only with the new **`browser` permission** you grant, only an address its lambda allows (`tests/browser-ext.test.ts`). Every built-in with a port offers *Switch to the plugin* on its card on the Plugins page (`src/plugins/ports.ts`). ✅ correlations — `plugins/correlations-ext`: the daily series became the kernel's (`src/lib/series`, `series.catalog` / `series.read`, the boundaries kept); the computing and the words are the built-in's own pure core (`src/plugins/correlations/core.ts`), bundled into the plugin's lambdas by `scripts/port-correlations.mts` with its German and Spanish texts — one source, the same sentences; lambdas know the user's language (`context.language`); the `correlations` tool and the widget (a port's widget takes over the built-in's id: `replaces`); the built-in's tool and widget tests pass against it (`tests/correlations-ext.test.ts`, `correlations-widget-ext.test.ts`). Not ported yet: the explore page (`/correlations`) — it stays Zeff's and works with the port (G). ✅ agenda — `plugins/agenda-ext`: a package generated from the built-in's template (`scripts/port-agenda.mts`), made in your language (`localize`); its screen the built-in's own made of the view language alone (`toPortScreen`: the sidebar from the lambda `agenda.data` through `<data lambda>`, the new-note form a `<dialog>` whose Save runs the package's flow `agenda.add-note` through the kernel's `db.add`); the switch turns your Agendas' screens (your changes kept). Kernel pieces it brought: `db.schema`, `db.query raw`, `db.add`, package flows writing their own databases (`@pkg.iN`), packages with two-way relations, `localizePackage`. Tested in `tests/agenda-ext.test.ts`. Not yet 1:1: a new Agenda's People field is a choice, not the People plugin's contacts; a new one has no calendar event field (one you switch keeps its own); the dialog doesn't preselect the project or *on the agenda* from where you are, and picks tags by typing. ✅ mail-client — `plugins/mail-client-ext`: what its lists show is the built-in's own `view-data.ts`, bundled into the plugin's compute script (`scripts/port-mail-client.mts`) and run in your browser in a sandboxed frame; its three screens (Mail, Chat, Inbox) are the built-in's templates with every part made of the view language (`src/plugins/mail-client/port.meta.ts`): the conversation through `mail.thread`, the reply through `row.reply.draft` and `row.op` (Outlook draft, Gmail send / draft, IMAP send), snooze through `rows.set`, archive through `mail.archive` / `mail.archive-read`, Gmail's archive and unread through `mail.gmail-change`, read after a moment through `mail.mark-read`, new inboxes through `mail.inbox-templates` / `mail.new-inbox`. New mail databases get its screens (`contributes.appViews`). The switch turns your mail, chat and inbox views (your changes kept). Tested in `tests/mail-client-ext.test.ts` (the compute script against the built-in, the screens drawn without an error). Kit pieces it brought: `<col dock=bottom>`, `<col scroll=… end=true>`, a button's `undo=`, an input's `enter=` and `rows=`, `<data reload=true>`. Next: revolut needs an API of the built-in cases for its bank first.
3. mail-client and agenda (G + F), correlations (A + F), revolut (F).
4. ✅ google-calendar — `plugins/google-calendar-ext`: a package with one sync flow (`google-calendar.sync`, every 15 minutes between 8 and 19, the built-in's interval taken over) calling the kernel's `gcal.sync`; reading Google (API or the automation Chrome) and writing Zeff's calendars moved into the kernel as a driver (`src/lib/google/calendar-sync.ts`). The switch installs the package under System and allows its flow what it asks. Tested in `tests/google-calendar-ext.test.ts`. Next: local-ai.
5. The connectors, once E + C + D + I exist.
6. The big apps last — each rebuilt as a package + views + flows + functions, the way Learn was, not ported.
