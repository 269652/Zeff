# Widgets — one base for the small apps an AI writes

A **widget** is a small program, written on the fly as HTML and JavaScript: a Learn exercise, a plot in the teacher's
message, a form that fills a database, a live table, a calculator. Zeff runs every widget the same way, wherever it is
shown:

| Where | How it gets there | Data bridge |
| --- | --- | --- |
| A page's block (`zeffApp`) | `/` → *AI … → Widget (AI-built)*: you describe it, `makeWidget` builds it; or the assistant's `workspace_widget` with `page`; or Markdown `:::app` | yes |
| The Workspace assistant's answer | `workspace_widget` → a chat embed (`WidgetEmbed`), *+ Add to this page* | yes |
| A widget kept in a row (an exercise, a simulation) | `<codewidget>` in a view, from the row's code or exercise set | its results go to a flow |
| An exercise in the view language, kept in a row | `<subview>` in a view (no frame, no code: Zeff's own parts); `<button action="report">` | its results go to a flow |

## Talking to a plugin's chat

A widget may talk to a live chat a plugin brings ([manifest `chats`](plugins/manifest.md)), once the user has allowed that chat for the widget's code (`meta: chat:<plugin>.<chat>`): `await zeff.chat.state("my-plugin.lesson", key)` (has it begun, how many messages, is the agent speaking), `zeff.chat.begin(chat, key, title, first)` and `zeff.chat.send(chat, key, text)`. So a widget the assistant builds on the fly can be the face of an agent — a tutor, a coach, a reviewer — without more than a few lines.

## The parts

| File | What it is |
| --- | --- |
| [src/lib/widgets/sandbox.ts](../src/lib/widgets/sandbox.ts) | The frame's document (`buildSrcdoc`): CSP (no network, `form-action 'none'`), the bridge script (`window.zeff`), `zeff.context`, the libraries inlined; `parseWidgetMessage` checks everything the frame sends |
| [src/lib/widgets/bridge.ts](../src/lib/widgets/bridge.ts) | The calls a widget may make (`CALL_METHODS`, each with its need: read, write, ai, host), `parseCall`, `widgetKey` (a hash of the code), wants and grants |
| [src/lib/widgets/kit/kit.js](../src/lib/widgets/kit/kit.js) | `ZeffKit`, in every frame: the exercise kit (`mount`), `plot`, `expr`, `fmt`, and the app parts `form`, `table`, `stats`, `h`, `style` |
| [src/lib/widgets/guide.ts](../src/lib/widgets/guide.ts) | `WIDGET_GUIDE`: the one text every AI reads before writing a widget (built from `CALL_METHODS` and `WIDGET_LIBS`, so it can't drift) |
| [src/components/widgets/WidgetFrame.tsx](../src/components/widgets/WidgetFrame.tsx) | The sandboxed iframe (`allow-scripts allow-forms`): height, results, errors, `onCall` (answers calls), `pulse` (sends `changed`) |
| [src/components/widgets/MessageBlocks.tsx](../src/components/widgets/MessageBlocks.tsx) | Fenced blocks in a message as widgets (`render` lets a host draw them with its bridge) |
| [src/plugins/workspace/widget-bridge.ts](../src/plugins/workspace/widget-bridge.ts) | The server's side: `widgetCall`, grants (pref `widgets.grants`), `widgetContext` |
| [src/plugins/workspace/widget-make.ts](../src/plugins/workspace/widget-make.ts) | `makeWidget` (LLM task `widget-make`, prompt `widget-make`): the guide, the page's databases with their fields, the current widget when changing; checked by `widgetProblem` and sent back once |
| [src/plugins/workspace/ui/app-widget.tsx](../src/plugins/workspace/ui/app-widget.tsx) | `AppWidget` (frame + bridge + the *Allow* bar) and the block `ZeffApp` |
| [src/plugins/workspace/mcp-widgets.ts](../src/plugins/workspace/mcp-widgets.ts) | `workspace_widget_docs`, `workspace_widget` |

## The bridge

Inside the frame, `zeff.db.list/schema/rows/add/update`, `zeff.state.get/set`, `zeff.ai`, `zeff.toast`, `zeff.open`,
`zeff.on("changed", fn)` and `zeff.context`. Each call is a `postMessage` with an id; the host answers once with a
value or an error, and the promise in the widget settles. The host answers `state.*`, `toast` and `open` itself (a
block keeps its state in its `state` attribute). Everything else goes to the server action `widgetCallAction`, and
`widgetCall` checks it again:

- **read** — any database whose label isn't *secret*. Values come by field name: numbers, ticks, choice names, lists.
- **write** — only to a database granted to this widget's **key** (the hash of its code). The AI can only *ask*
  (`writes`, `ai` on the block, the embed or `:::app`). Grants come from **Allow** on the widget, and from a block
  built in a page for the databases on that page. A widget changed at your request keeps what you had allowed it.
- **ai** — only when granted, and at most 20 questions an hour per widget (LLM task `widget-ai`).

After a write the host fires `ws-changed`. The databases on the page and every widget, which hears `changed`, then
read again.

## Widgets on one page work together — and with all of Zeff

| Call | What it does | Where it goes |
| --- | --- | --- |
| `zeff.page.set(key, value)` / `zeff.page.get(key?)` | Values the widgets on one page share; the others hear `zeff.on("page", ({ key, value }))` | `ws_widget_page_state`, by page (`setPageState`, widget-bridge.ts) |
| `zeff.emit(name, detail)` | A message to the other widgets on the page (`zeff.on(name, …)`); a widget that loads later is told the last message once when it registers (`bus.last`) | the page's bus (`zeff-widget-bus` window event, app-widget.tsx) |
| `zeff.publish(name, value, { unit, label })` | A value for the whole of Zeff — number, text, list, table | `ws_widget_outputs` (widget-outputs.ts); a name belongs to the block that published it first |
| `zeff.values.get(name)` / `.list()` | What any widget published | — |
| `zeff.flow.run(name, input)` / `zeff.flow.list()` | Zeff's server side: web, APIs, lookups, AI extraction, rows written — only flows the user allowed this widget (`flows` on the block, grant `flows`) | flows/engine.ts, trigger `{ kind: "widget" }` |

A published value is read by other widgets anywhere, by views (`{{ outputs.total }}`, `<datatable
source="outputs.results">`, `[outputs.Name with spaces]`), as a **Kennzahl** when it is a number (formulas:
`kennzahl("name")`, the Kennzahlen page, Today — a `workspaceMetrics` contribution in server.ts), and by the assistant
and agents: `workspace_widget_outputs` lists or reads them, `workspace_output_to_database` pours a published table
into a database. When a widget is built, the AI is told the other widgets on its page and the keys and names they
share and send (`siblingsText`, widget-make.ts), so a new one fits in. A **named code cell** of the [Notebook](extensions/notebook.md) publishes what it returns the same way (and `zeff.publish(…)` in its code does too), so a widget can show the result of a Python or Node.js cell as `outputs.<name>`.

## Zeff's own structure (`zeff.meta`)

A widget can read and change how Zeff is built — **only when the user allowed it**, kind by kind, for this widget's code (a changed
code asks again). The widget names what it wants in its `meta` list (the block's attribute, or `"meta": ["pages", "read"]` in a
`:::app` header); Zeff shows *This widget wants to change Zeff's structure: pages* with the usual Allow button.

| Call (one `args` object) | Permission |
| --- | --- |
| `zeff.meta.tree()` · `schema({ database })` · `blocks()` · `flows()` · `plugins()` | `read` |
| `pageCreate({ title, markdown, parent })` · `pageUpdate({ id, … })` · `pageArchive({ id })` | `pages` |
| `databaseCreate({ title, properties, views })` | `databases` |
| `databaseAlter({ database, ops })` | `schema:<id>` (per database) |
| `blockSave({ block })` · `flowSave({ flow, page })` · `pluginSave({ id, manifest, files })` | `blocks` · `flows` · `plugins` |
| `pageDelete` · `blockDelete` · `flowDelete` · `pluginDelete` | `delete` |

What a widget makes is inert: a flow it saves has no permissions, a plugin is written switched off, pages go to the trash. The same
API is in [Notebook](extensions/notebook.md) cells and in flows (the `meta.read` / `meta.run` actions). See [Zeff in Zeff](zeff-in-zeff.md).

## Libraries and the science kit

Every library is in [sandbox.ts](../src/lib/widgets/sandbox.ts) `WIDGET_LIBS` and served by
[libs.ts](../src/lib/widgets/libs.ts): KaTeX, JSXGraph, Chart.js, **three.js with its add-ons** (OrbitControls,
MarchingCubes, SimplexNoise, CSS2D labels, bloom …), **mathjs** (units, matrices, derivatives), **Algebrite**
(computer algebra), **Plotly** (scientific 2D/3D plots), **d3**, a **world map** (`geo`), **3Dmol** (molecules,
proteins), **SmilesDrawer**, **physics** (cannon-es, matter.js), **Cytoscape** (networks), **astronomy-engine**,
**simple-statistics**. three.js with its add-ons, the physics engines and the world map are put together by
[scripts/widget-libs.mjs](../scripts/widget-libs.mjs) (esbuild) into `node_modules/.cache/zeff-widget-libs` the first
time one is asked for.

[kit/science.js](../src/lib/widgets/kit/science.js) adds to `ZeffKit`: numerics (`ode` — RK4 and adaptive RK45,
`integrate`, `root`, `minimize`, `derivative`, `grid`, `fit`), scientific colour maps, `tex`, `scene` (three.js in
one line: lights, orbit controls, labels, glow, resize), `isosurface` (organic surfaces from a field — a brain, a
cell), `pods` (results one under the other) and `alpha` (a Wolfram|Alpha-like calculator: the AI only says what to
compute, mathjs and Algebrite compute it in the frame). Learn's exercises are widget blocks like any other (no
databases, flows, page or published values).

## Versions

A page's widget block has an id (`wid`) and every change is a version
([widget-versions.ts](../src/plugins/workspace/widget-versions.ts), `ws_widget_versions`, the newest 60): built or
changed by the AI (✨), its code edited (`</>`), an error fixed by the AI (🩹 — offered when the widget reports one),
an older one brought back (↶). 🕘 on the block lists them, shows any of them as it was and brings it back. When it
changes a widget, the AI reads the requests so far. A copy of a page (duplicate, template) starts its own history.

## Apps, templates, plugins

[packages.ts](../src/plugins/workspace/packages.ts) moves widgets with their page: a database of the package in a
widget's code (`db: 12`, `zeff.db.rows(12)`) becomes a placeholder on export and the new id on install, `writes`
likewise; the page's shared values and the flows below it come along (their permissions granted again by whoever
installs it). **⋯ → Save as plugin** writes a plugin folder (`app-<name>/zeff-plugin.json` + `app.json`, manifest
field `contributes.workspacePackages`): switched on, its app is offered under New → templates.

## Markdown

```
:::app {"title":"Sign up","libs":["chart"],"writes":[12],"state":{…}}
<div id="f"></div><script>ZeffKit.form("#f", { db: 12 })</script>
:::
```

A line of the code that is just `:::` is written as ` :::` and read back as `:::`. `sanitizeDoc` keeps the code whole
(up to `MAX_WIDGET_HTML`), the state up to `MAX_STATE`, and only libraries Zeff has.

## Tests

- [tests/widget-apps.test.ts](../tests/widget-apps.test.ts) covers the call checks, keys and grants, reads and writes
  by field name, secret databases, the Markdown round trip and the assistant's tool.
- [tests/widget-apps-browser.test.ts](../tests/widget-apps-browser.test.ts) uses real Chrome: `ZeffKit.form` and
  `ZeffKit.table` over the bridge, a refused call, and a table refreshed by `changed`.
- [tests/widget-kit-browser.test.ts](../tests/widget-kit-browser.test.ts) covers the exercise kit.
- [tests/widget-science-browser.test.ts](../tests/widget-science-browser.test.ts) uses real Chrome: every library
  loads under the frame's rules, the science kit computes (ODEs, integrals, roots, fits), mathjs and Algebrite
  answer, a three.js iso-surface brain renders, `ZeffKit.alpha` computes the pods.
- [tests/widgets-pro.test.ts](../tests/widgets-pro.test.ts) covers flows only as allowed, a page's shared values,
  published values (owners, a Kennzahl, a view's `outputs`, a table poured into a database), versions, packages
  moving widgets with their databases, flows and shared values, and a page saved as a plugin.
