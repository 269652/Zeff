# How built-in plugins plug into each other

A plugin is a folder `src/plugins/<id>/` that owns its code. Where it needs another plugin's feature, it does
not import the other plugin and the other plugin does not import it: the feature's owner defines an
**extension point**, the plugin **contributes** to it. An uninstalled plugin's contribution is not there.

```
kanban/board-providers.ts      export const boardProviders = extensionPoint<BoardProvider>("kanban.boardProviders")
jira-lage/contribute.ts        boardProviders.contribute("jira-lage", { idPrefix, list, get })
plugins/contributions.ts       import "./jira-lage/contribute"      <- one line per contributing plugin
kanban/providers.ts            boardProviders.list()                <- installed plugins' contributions only
```

The kit is `src/lib/plugin-kit/extension-point.ts` (`extensionPoint`, `.contribute`, `.list`, `.all`).

## The rules

1. **The owner defines the shape.** The point lives in the owning plugin's folder, typed. A contribution is plain
   data and functions, no UI imports from the owner's internals.
2. **A contributor only imports the owner's point file** (`kanban/board-providers.ts`), never its other files,
   and keeps what it brings in its own `contribute.ts`.
3. **Heavy code loads lazily** (`await import("./board")` inside `list`/`get`), so registering costs nothing
   and an uninstalled plugin's code is never loaded.
4. **The owner reads `list()`** — it is already filtered by `isInstalled`; the owner never checks for a
   specific contributor by name.
5. **Adding a plugin = its folder + its `PLUGINS` entry + one line in `plugins/contributions.ts`.**
   Removing it = the reverse. No other file names it.
6. **Each point has a test** with a fake contributor under another plugin id and an uninstall step
   (see `tests/plugin-kit.test.ts`).

## Done

| Point | Owner | Contributors |
| --- | --- | --- |
| `kanban.boardProviders` | Kanban | Jira Lage |

## Closed lists to turn into points (in this order)

| Today (closed list) | Becomes | Why this order |
| --- | --- | --- |
| `plugins/actions/catalog.ts` `ACTIONS` (static imports of every plugin's action) | `actions.types` | Every integration plugin is hard-listed there; new plugins can't bring actions |
| `plugins/llm/tasks.ts` `llmTasks`, provider union | `llm.tasks`, `llm.providers` | AI-using plugins (Documents, News, People …) can't register their own task |
| `lib/sync/registry.ts` `SYNC_KEYS`, `plugins/drivers.ts` `DriverId` | `sync.steps`, `drivers` | A new source needs sync + a driver; both closed |
| Chrono / Punch in `lib/chrono.ts`, `lib/punch.ts`, pages, sync registry | `report.exportTargets` | Branch `extract-chrono-punch` (another session) is moving them out; build the point on top of that, not beside it |
| `PLUGIN_IDS` in `plugins/catalog.ts` | ids derived from manifests | Last: touches everything that has `PluginId` |

## Not yet decided

- **One manifest per plugin** (`src/plugins/<id>/plugin.ts`) assembled into `PLUGINS`, instead of the 640-line
  `catalog.ts`. It removes the central list but touches a file every session edits; do it when no other
  session has `catalog.ts` modified.
- **Giving external plugins the same points** (`docs/plugins`): a manifest section that contributes to a named
  point, with the permission it needs. Needs the points above first, since external plugins can only extend Work today.
