# Widgets — one base for the small apps an AI writes

A **widget** is a small program, written on the fly as HTML and JavaScript: a Learn exercise, a plot in the teacher's
message, a form that fills a database, a live table, a calculator. Zeff runs every widget the same way, wherever it is
shown:

| Where | How it gets there | Data bridge |
| --- | --- | --- |
| A page's block (`zeffApp`) | `/` → *AI … → Widget (AI-built)*: you describe it, `makeWidget` builds it; or the assistant's `workspace_widget` with `page`; or Markdown `:::app` | yes |
| The Workspace assistant's answer | `workspace_widget` → a chat embed (`WidgetEmbed`), *+ Add to this page* | yes |
| A Learn lesson | the teacher's `learn_widget`, or a ` ```widget ` / ` ```plot ` / ` ```chart ` / ` ```svg ` block in its message | results only (`zeff.report`) |

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
