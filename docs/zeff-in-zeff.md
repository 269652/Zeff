# Zeff in Zeff

**Goal:** the whole Zeff — its extensions (plugins), connectors, syncs, AI tasks, actions, pages and settings, not one app — can be
built and run *inside* Zeff, with the building blocks Zeff itself offers. Today the built-in plugins are TypeScript in `src/plugins/`
that needs a rebuild; an external plugin can only bring rules, commands, panels, apps, hooks and MCP servers. This page is the plan and
where it stands.

## Where Zeff is (a survey)

- **Turing-complete pockets**: flows (branches, `foreach`, sub-flows, a script node — with deliberate limits: depth 5, 500 steps),
  widgets (full JavaScript in a locked frame), Notebook cells (Python, Node.js, Rust). The view template language is declarative on purpose.
- **What blocks it:** no user-defined backend (server functions, endpoints, MCP tools), no way for code to change Zeff's structure, no
  plugin layer that reaches the extension points the built-ins use (actions, AI tasks, sync steps, board providers, server actions,
  routes, nav, settings), a view language without functions that return values, no package versions or migrations, no auth model for
  apps, no tests or source control for user-made parts.

## The stages

1. **Meta API** — code makes and changes Zeff's structure, behind permissions. *Done: `zeff.meta` in Notebook cells (Python, Node.js),
   widgets and flows (`meta.read` / `meta.run`): pages, databases with fields and views, blocks, flows, plugins — reading the structure,
   writing, deleting; each kind a permission of its own, what code makes inert. Still to do: the plugin parts beyond rules, commands and
   apps (stage 2) and Rust cells.*
2. **A plugin runtime for external plugins** — everything a built-in plugin contributes through `extensionPoint`s (actions, LLM tasks,
   sync steps, board providers, server actions, API endpoints, MCP tools, settings pages, routes and nav) becomes available to an external
   plugin, run in a sandbox with declared permissions. *Started: **server functions** — `contributes.functions` in the manifest: Python or
   Node.js code that runs in the Notebook's containers, called over HTTP (`/api/ext/fn/<plugin>/<name>`) and from Notebook cells
   (`zeff.call`), with the permissions the user grants the function in advance ([manifest](plugins/manifest.md)). Also called from widgets, flows and over MCP. Also **flow actions** (`contributes.flowActions`, done by a function). Also **lookups** and **data sources** (`contributes.lookups`/`sources`, read by functions). Also **webhooks** (`webhook: true`, with a secret). Also **field types** (`contributes.fieldTypes`, no code) and **AI for functions and cells** (`zeff.ai`, its own permission). Menu entries and pages come from the panels/apps. *Stage 2 is done;* what is left (views calling functions, widgets as plugin parts) belongs to stage 3, the view language.*
3. **A general view language** — functions that return values, lists and objects as state, own events, bounded recursion; the
   missing UI elements (rich text, upload, drag and drop, shortcuts, theming) and an app shell with routes, navigation, settings panels.
   *Started: **`<def>` functions** (values, recursion within a budget of calls and depth, as formula and as filter), `map` / `keep` /
   `reduce` / `range`, lists and objects in the state as JSON text (`fromjson`, `push`, `put` …). Views reach plugin functions through flows
   (`run=`, `<data flow=>` and `contributes.flowActions`). Also `<markdown>` (rich text), `<upload>`, own events (`emit` / `<on>`) and keyboard shortcuts, `<drag>` / `<drop>`, `<theme>`, app settings (`<setting>` / `<settings/>`). *Stage 3 is done;* the rest of an app shell (routes, navigation) is `<nav>`, `<tabset>` and the settings form.*
4. **Packages that live** *(done: ids and versions, requirements, update in place that keeps what is yours, declared migrations, permission list, shipped tests, history with roll-back; settings page and `workspace_package_*` tools)* — versions, dependencies, data migrations, update in place, permission manifests, tests that ship with a
   package, history across a whole package.
5. **The benchmark: Learn** *(done — Learn in Zeff IS this plugin now: the old built-in Learn is removed, its data brought over by the setup page ([docs](extensions/learn.md)); started: [src/plugins/learn/bundled](../src/plugins/learn/bundled) — skill tree, spaced repetition, experience, levels and streak as an external plugin with a package, views, flows and server functions; written with a test, `tests/learn-external.test.ts`, which has not been run yet. Found missing and built on the way: databases of a plugin's own package named by their place in it (`@pkg.i3`) in `needs` and in code, choice fields written by option name, "install and allow what it asks". Closed after that: the teacher (a conversation per lesson that leaves cards, builds quiz widgets and masters the step), research with sources (`web.search` → plan), study times in the calendar (a new Calendar API, `zeff.api`), lesson todos, and the course/lesson screens as one app view. What differs from the built-in Learn: the teacher is one AI call per message, not a live session with the Claude CLI's tools.)* — — rebuild the Learn extension (plan, skill map, lessons with the teacher, game mechanics, flashcards) as an
   external plugin on the new layers; whatever it cannot yet express is the next thing to build. Then the rest of the built-ins, one by one.

## Rules that hold on every stage

- **Behind permissions you grant**, asked when the code first needs it, kept, revocable. Writes and structure changes have sets of
  their own, apart from reading.
- **What code makes is inert until you switch it on**: flows get no permissions, plugins are written switched off, deletions go to the trash.
- **Everything is tested and documented** before the next stage starts.

## Tidied up after stage 5

Checked afterwards: the tests of packages, views, meta/functions and the Learn benchmark (6 of 6) pass, and 571 of 573 in the wider workspace set. Fixed on the way: functions that call functions of their own plugin waited for themselves (one session per nesting level now); `award` finds a course from a relation's text. One test fails for a reason of its own: `routineView` in `tests/workspace-routines.test.ts` expects a finished agent run to count as done, but `syncAgentRuns` now marks a run failed when the worker never reached Zeff's MCP, and the test does not say it did.

- One way to run a plugin's function from flows, widgets, lookups and sources (`workspace/plugin-fn.ts`) instead of four copies.
- One place that knows where a package's parts are (`workspace/package-refs.ts`: `@pkg.iN`), used by code, flows and grants.
- One place that grants and checks what a plugin's functions need (`notebook/grants.ts`: `needsGranted`, `grantNeeds`).
- One way to apply a filter in a view (`applyFilter` / `applyFilters`) for `{{ }}` in text and in attributes.
- A guard for the assistant's tools (`guarded`), one rule for dotted ids in the manifest (`dotId`).
- `package-life.ts` split by what it does: `semver.ts` (versions), `package-registry.ts` (what is remembered), `package-tests.ts`,
  `package-migrations.ts`; an update applies each kind of page through a small function (add a kind = add one).

## Learn must be 1:1 before it replaces the old one

The built-in Learn stays until Learn can do everything it does; what cannot be said yet is a building block Zeff gets.
Done so far: the skill map as a generic graph element (`<graph>`), widgets talking to a plugin chat (`zeff.chat`), exercises as free-form widgets and exercise sets (`<codewidget>`, `workspace.widgets.check`, `workspace.widgets.guide`), the live teacher
(`contributes.chats`: the plugin's rules, a context function, Zeff's tools; the conversation kept in an editable database; `<chat>`; the
result of an exercise and a widget's error told to the teacher). To do: plugin schedules (the hourly
upkeep, study times four weeks ahead), several learning spaces, interests, update planning and planning anew, removing a course, the research
over OpenAlex / Semantic Scholar / arXiv with the plan check, the timeline with snapshots, the phone layout, the lock of unopened steps.

## Learn: replaced

The Learn that was built into Zeff is gone; Learn is now this plugin ([docs](extensions/learn.md)): its code is the bundled external plugin
(`src/plugins/learn/bundled`), set up on one click on `/learn`, with the old data brought over. Building it added to Zeff's kit, all of it
general: `<codewidget>`, `<chat>` and plugin chats, `<graph>`, `zeff.api` / `zeff.ai` for code, plugin schedules, a calendar API,
package references (`@pkg.iN`), widgets reaching plugin chats. A copy of the removed code is kept next to the project (`Zeff-learn-alt`).

## Versions and repair for every part

Every part an app is built of keeps its earlier states and can be brought back by you or the assistant — a page's text, a view's template, a database's fields, a flow, a routine, a form, a widget, a block, a plugin's function, a whole package ([table](extensions/workspace.md#versions-of-everything-you-build)); a whole app keeps versions and save points of every page below its top page (its *History* → *Whole app*), each brought back at once or made a new app or a template. *Repair with the AI* is one click for views, widgets, flows, functions and installed apps. Tested in `tests/part-versions.test.ts`.

## Changes you ask for, at runtime

Zeff changes for your case when you say so — not by itself. You point at a piece of the screen (👆 in the Workspace assistant), say what
would work better, and the assistant changes the smallest thing that does it: what you built, a plugin's app or function, or — when Zeff
itself must change — a [mod](mods.md#for-your-case-point-say-try-keep-or-undo). A mod comes as a card under the answer to switch on and try,
is for the account you are in, and *Undo* takes back everything the answer changed (pages, part versions, functions, blocks, mods). A mod
an update of Zeff held back is adapted with one click. Tested in `tests/mods.test.ts`.
