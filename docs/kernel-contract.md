# The kernel contract

This is what Zeff's kernel promises to everything built on it: plugins, packages, views, flows, widgets and functions. A part that
only uses what is listed here keeps working when the kernel is updated, as long as the contract version stays the same. The plan
behind it is [the kernel and the rest](zeff-kernel.md), stage 0.

**Where it lives:** `src/lib/kernel/contract.ts` (`KERNEL_CONTRACT`). **The check:** `tests/kernel-contract.test.ts` compares every
list with the code, in both directions. It fails when the code offers something the contract doesn't name, or when the contract names
something the code lost. That way the contract never changes by accident.

## The version

The contract's version is the **extension API version** that external plugins already declare (`apiVersion` in `zeff-plugin.json`,
`API_VERSION` in `lib/ext/manifest.ts`). It is **1** today. A plugin written for a higher version than the running Zeff knows is
refused.

| Change | What to do |
| --- | --- |
| Something **new** (an element, a call, a manifest key, an extension point) | Add it to `contract.ts`. The version stays the same, because old parts keep working. |
| Something **changed in meaning** or **removed** | First a deprecation: it still works and says it will go. Once the package tests show nothing installed uses it, remove it and raise `API_VERSION`. |

## What it covers

| Surface | Source of truth in the code | Count (2026-11-13) |
| --- | --- | --- |
| Extension points | `extensionPoint<…>("name")` anywhere in `src/` | 24 |
| What a manifest may contribute | the `contributes` schema in `lib/ext/manifest.ts` | 24 |
| `zeff.*` in server functions and Notebook cells | `accessFor` in `plugins/notebook/zeff-access.ts` | 16 |
| `zeff.*` in widgets | `CALL_METHODS` in `lib/widgets/bridge.ts` | 25 |
| Meta operations (structure) | `META_OPS` in `plugins/workspace/meta.ts` | 17 |
| Flow steps | `NODE_KINDS` in `plugins/workspace/flows/types.ts` | 14 |
| View-language elements | `VIEW_TAGS` in `plugins/workspace/view-template.ts` | 109 |
| Formula functions | `FORMULA_FUNCTIONS` in `plugins/workspace/formula.ts` | 43 |

## How a plugin reaches each extension point

Every extension point says in `contract.ts` how an external plugin reaches it:

| Form | How a plugin reaches the point | Points |
| --- | --- | --- |
| **stored** (13) | From its manifest, with no TypeScript ([the manifest](plugins/manifest.md)). | `fieldTypes`, `flowActions`, `lookups`, `sources`, `workspacePackages`; since stage 0 also `formulaFunctions` (a formula), and `metrics`, `rowBadges`, `tabMenus`, `widgets`, `pageNav`, `reviewSources`, `reviewLinks` (each answered by a plugin function) |
| **covered** (5) | It already gets what it needs another way; the point is how built-in TypeScript does the same. | `items.collections` and `workspace.templates` (a package's databases and pages), `workspace.pageApps` (a package's pages with their views and blocks), `proposals.sources` (`reviewSources`), `workspace.appNav` (the view's own `<nav>`) |
| **kernel** (3) | TypeScript on purpose, because it is part of the kernel. A plugin uses `functions` instead. | `api.methods`, `notebook.kernelLanguages`, `workspace.lambdas` |
| **owner** (3) | The point of one built-in plugin's own domain. It gets its stored form when that plugin is rebuilt as a package. | `correlations.series`, `documents.texts`, `questions.views` |
| **todo** (0) | Still TypeScript only. | none |

The test fails when a point has no form. A new extension point must say how a plugin reaches it.

**How it works:** an extension point takes *providers* (`point.provide(key, fn)` in `lib/plugin-kit/extension-point.ts`). A provider is
asked on every read and answers with what is there now. `plugins/workspace/ext-points.ts` is the provider for the stored forms added in
stage 0. It also makes every function's answer safe: only known fields, links inside Zeff (widgets may also link to web addresses), and
lengths kept short.
It reads the manifests of the plugins that are on, so a plugin switched on, off or updated shows at once, and safe mode leaves nothing
behind. An external plugin contributes as `ext:<id>`.

## Not covered yet

- **The filters of the view language** (`| date`, `| map(…)`, `| fromjson` …). They are spread over several tables in
  `view-template.ts` and `card-template.ts`, and there is no single list to check. Exporting one list is a small change to
  `view-template.ts`, and it waits until that file isn't being edited elsewhere.
- **Flow triggers and the built-in flow actions.** The actions come through `workspace.flowActions`, and the triggers are a type with no
  list.
- **Driver capabilities** (`zeff.mail.*` and the like, in [the kernel and the rest](zeff-kernel.md#the-line)). They don't exist yet.
  Each one joins the contract when it is built.
- **The attributes** of view elements and **the arguments** of calls. Today the contract checks names, not shapes.
