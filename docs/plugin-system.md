# The plugin system

Zeff is made of plugins, and the built-in ones and the external ones (`docs/plugins`) work the same way: they
describe themselves in a manifest, they bring things to a few **extension points**, and they talk to each other
through **one API**. Nothing outside a plugin's folder needs to know it exists.

## A built-in plugin is a folder

```
src/plugins/<id>/
  plugin.ts        what it is: name, category, tabs, pages, settings, sync steps, dependsOn, extensions   (client-safe data)
  server.ts        what it registers for others: API methods, board providers, tab menus …               (server only)
  api.ts           its API methods and permissions (imported by server.ts)
  actions.ts       its actions: `export const <NAME>_ACTIONS = [...]` and its operation types (TodoOpMap)
  llm-tasks.ts     the AI tasks it has Zeff run: `export const <NAME>_LLM_TASKS = (t) => [...]`
```

Only `plugin.ts` is required. After adding or removing a file, run **`npm run plugins:index`**: it writes four
generated files (`src/plugins/*.generated.ts`) that list the folders' contents — the plugin list, the `server.ts`
imports, the action lists, the AI task lists. `tests/plugin-index.test.ts` fails while they are stale, so a plugin is
added or removed by its folder alone; no other file names it.

## What a plugin can bring

| Brings | Where | Seen by |
| --- | --- | --- |
| a place in the app (tabs, apps, nav, settings, routes, services) | `plugin.ts` | header, menu, setup |
| sync steps | `plugin.ts` (`syncSteps`) — the steps themselves are still in `lib/sync/registry.ts` | Sync menu, scheduler |
| **API methods and permissions** | `api.ts` → `apiPoint.contribute(id, …)` in `server.ts` | every plugin, built-in or external |
| **hook events** | the same contribution (`events`, optionally tied to a change topic) | external plugins' hooks |
| **actions** (buttons on todos) and their operation types | `actions.ts` | todos, auto actions, the AI |
| **AI tasks** | `llm-tasks.ts` | the LLM settings, `llm()` |
| **boards for Kanban** | `server.ts` → `boardProviders.contribute(id, …)` | Kanban overview and menu |
| **tab dropdowns** | `server.ts` → `tabMenus.contribute(id, …)` | the header |
| rules, commands, panels, apps, MCP servers, hooks | external plugins' `zeff-plugin.json` | Work, the menu |

A built-in plugin's contribution is there while the plugin is installed (`isInstalled`); an external plugin's while
it is on. The owner of a feature **defines the point** (typed) in a small file of its own and **reads `list()`** —
never a plugin by name. A contributor imports only the owner's point file.

## Integrations in repositories of their own

A plugin can also live outside this repository (Chrono and Punch do: `docs/integrations.md`, mounted under
`integrations/<name>/`). Its `meta.ts` is the same data a `plugin.ts` holds (the catalog adds those entries to Zeff's
own, after them in the lists), its `server.ts` the same kind of module. They are not yet generated into the same
indexes as the plugins in `src/plugins/`; the next step is to give mounted plugins the extension points too (API
methods, actions, AI tasks) so that an integration is a plugin in every respect.

## One API

`src/lib/plugins/api.ts` is the registry. A method is registered by the plugin it belongs to (`kanban.cards.add` by
Kanban) and is there while that plugin is. Callers:

- an **external plugin**, over HTTP with its token or from a panel: it needs the method's permission, which you
  granted when you turned it on;
- **built-in code**, in-process: `callBuiltin("my-plugin", "kanban.cards.add", {...})` — no HTTP, no token, the same
  method.

Permissions are brought by plugins too (`kanban.read`); a manifest naming one nobody brings is refused. The same goes
for hook events. So a new plugin that brings methods automatically extends what external plugins can do, with the
permission model unchanged. `docs/plugins/api.md` lists the methods; `tests/ext.test.ts` fails when a method,
permission or event is missing from the docs.

## Rules

1. **The owner defines the shape.** A point lives in the owning plugin's folder, typed. A contribution is plain data and
   functions.
2. **A contributor imports only the owner's point file**, never its other files. A point is in a file of its own
   (`kanban/board-providers.ts`, `lib/plugins/api-point.ts`, `plugins/tab-menus-point.ts`), so `server.ts` can register
   without loading the file that loads all `server.ts` files (an import cycle otherwise).
3. **Heavy code loads lazily** (`await import(...)` inside a method), so registering costs nothing and an uninstalled
   plugin's code is never loaded.
4. **Order that mattered stays explicit**: `order` in `plugin.ts` (menus, lists), `actionsOrder` (the AI's action
   dictionary — unchanged on purpose).
5. **Each point has a test** with a fake contributor under another plugin id and an uninstall step.

## Not done yet

- **Sync steps** (`lib/sync/registry.ts`, `SYNC_KEYS`) and **browser drivers** (`plugins/drivers.ts`) are still closed
  lists; the registry mixes each step's logic with the scheduler's. Next: a `sync.steps` point whose contributions are
  `Step` objects from each plugin's `sync.ts`.
- **Export targets** (Chrono, Punch): the branch `extract-chrono-punch` moves them out of the core; the point should be built
  on top of that work.
- **External plugins** can bring API-reachable behaviour only through their programs (hooks, MCP servers) and panels;
  they cannot yet contribute actions, AI tasks, board providers or sync steps. Each needs a declarative form (a command
  to run) and a permission.
- **One list on the Plugins page** for built-in and external plugins; they are two sections today.
