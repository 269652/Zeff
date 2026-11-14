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
| A | a plugin's functions as Zeff's own MCP tools (Workspace chat, agents) | browser, web-search, correlations, entities, timeline, loops, gmail, imap … |
| B | a settings section with secrets (encrypted keys), a Set up step | lookups, web-search, local-ai, connectors, news … |
| F | Workspace extension points from functions: widgets, metrics, formula functions, review / proposal sources, row badges | correlations, mail-client, revolut, cases, people, finances … |
| C | schedules shown in the Sync menu (named step, interval, status, chained steps) | every connector, news, auto-actions |
| G | a view kind of its own in the view language where today's views use React (parts, row templates) | agenda, mail-client, calendar, cases … |
| E | high-volume or indexed data beyond Workspace databases | the connectors' mail and message stores, timeline |
| D | a host-side driver (Playwright on the automation Chrome, a debug port) | the web-reading connectors |
| I | todo action types from a plugin | the connectors |
| H | named AI tasks (routing, editable prompt) | auto-actions, cases, people, news … |

## Order

1. ✅ lang-de / lang-es — language packs in zeff-plugins (`plugins/lang-de`, `plugins/lang-es`); Zeff has no German or Spanish of its own any more.
2. lookups (B), web-search and browser (A + B / D).
3. mail-client and agenda (G + F), correlations (A + F), revolut (F).
4. google-calendar, local-ai.
5. The connectors, once E + C + D + I exist.
6. The big apps last — each rebuilt as a package + views + flows + functions, the way Learn was, not ported.
