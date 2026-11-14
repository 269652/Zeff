# The kernel and the rest

**Goal:** every Zeff update except a kernel update arrives as data — a package version with its migrations, applied at runtime, kept
in history and rolled back like any other part. The kernel is the only TypeScript that ships in a build. Everything above it lives in
the database, can be read, changed and repaired by you or the AI, and updates without a rebuild.

This page draws the line between the two and plans the way there. It follows [Zeff in Zeff](zeff-in-zeff.md) (stages 1–5 are done)
and the rule from Learn: **a port replaces the built-in only once it can do everything the built-in does**. Anything it can't express
yet becomes a general building block.

*Status: the plan is agreed, and its four open decisions were settled on 2026-11-13. Nothing here is built yet. The numbers are a
survey taken on that day.*

## Where Zeff is (survey)

- **Size:** about 214k lines of TypeScript, not counting tests. `src/plugins` has about 136k lines: Workspace about 61k (26k of it
  UI) and about 75k across 49 more plugins. `src/lib` has 47k, `src/components` 27k and `src/app` 14k.
- **How built-ins plug in:** `definePlugin` (data: tabs, routes, nav, sync steps, services, features) plus 23 extension points
  (`lib/plugin-kit/extension-point.ts`): sources, widgets, metrics, field types, formula functions, lookups, flow actions, page apps,
  templates, packages, row badges, app nav, API methods, collections, proposals, review sources and links, correlation series, document
  texts, question views, kernel languages, tab menus. A plugin's `server.ts` contributes to them when its module is imported.
- **What an external plugin can already bring** (`lib/ext/manifest.ts`): functions (Python and Node, in the Notebook's containers),
  flow actions, lookups, sources, field types, webhooks, chats, schedules, panels and apps, commands, rules, hooks and MCP servers.
  Packages bring databases, views, flows, widgets and blocks, with versions, migrations, tests and history.
- **Learn shows it works.** About 8k lines of built-in TypeScript became about 3.5k lines of plugin. Learn now ships from the
  zeff-plugins repository and is installed by `learn/setup.ts`. Building it added about a dozen general pieces to the kit.
- **Mods** ([mods](mods.md)): every exported function and component of `src/` sits behind a hook (about 5,000). A mod can wrap or
  replace any of them at runtime, without a rebuild. Mods are versioned, guarded and switched off when they keep failing, and there is a
  **safe mode**. They are files in `data/mods/`, not database rows, and they run with Zeff's own rights.
- **Storage:** SQLite (better-sqlite3 + Drizzle). The kernel's tables change through Drizzle migrations; packages bring their own data
  migrations.

## Work already underway (uncommitted, 2026-11-13)

Other work in progress already covers parts of this plan. This plan builds on it rather than next to it:

- **[Plugins from a repository](plugins/repository.md)** is part of stage 1. It has `packages.json` with sources, update notes, and a
  three-way merge per file and line (`lib/ext/merge3.ts`, `git merge-file`), with conflicts settled by hand or by the AI
  (`MergeResolver.tsx`, `merge-ai.ts`). Still missing for stage 1: **signed tags** (today it follows a branch and offers a version
  bump or new commits), the **merge per field** for what lives in the database (a package's databases, views and flows, by stable id),
  and **kernel-version requirements**.
- **[Runtime conversion](plugins/runtime-conversion.md)** is the porting plan for stages 3–5. It has the same rule (composed from the
  kit, not ported into an iframe) and a list of missing capabilities, K and A–I. Its capability **F** (Workspace extension points from
  functions) is the extension-point part of stage 0 here. That page's capabilities and order are what tiers A–C follow, and its tiers
  and this page's should be kept as one list.
- **[Mods](mods.md)** is the base of stage 2, and its safe mode (`lib/mods/store.ts`: `.safe-mode` or `ZEFF_SAFE_MODE=1`) is what
  stage 0 widens to plugins and packages.

## The line

A part belongs to the **kernel** if at least one of these is true:

1. **It runs or checks other code.** The renderer of the view language, the flow engine, the widget frame, the function sandboxes,
   the formula and filter evaluator, the Mods hook host.
2. **It decides rights.** Accounts and auth, grants (`notebook/grants.ts`), the check of `needs`, the rule that what code makes is
   switched off until you switch it on.
3. **It moves or keeps everything else.** Storage and the kernel schema, the package system (install, update, migrate, test,
   roll back), the meta API, part versions, backup.
4. **You need it to repair the rest.** Safe mode, a minimal shell (navigation, Plugins page, package history, the AI chat with
   repair) that works with **every** stored part switched off.
5. **It is a driver.** It holds a process or connection that a sandbox can't: OAuth callbacks, IMAP IDLE, WhatsApp, Signal, the
   browser, the Claude / Codex / Copilot CLI bridges, the local AI, the LLM providers. A driver stays thin: it exposes one capability
   to the kit (`zeff.mail.*`, `zeff.ai`, …). Everything it does *with* that capability is ported.
6. **It is a kit element.** The UI pieces the view language draws (`<graph>`, `<chat>`, `<markdown>`, `<upload>`, tables, the
   editor …). These are in `src/components` and the Workspace UI. They grow when a port needs something new, and they stay
   general ([the parity rule](zeff-in-zeff.md#learn-must-be-11-before-it-replaces-the-old-one)).

Everything else is **above the line**: what a plugin knows about its domain (mail, people, news, cases, finances …), its screens, its
syncs, its AI tasks, its prompts and its schedules.

**Expected size:** about 50–70k lines stay in the kernel and about 140k are ported. Ported code usually shrinks; Learn went to 45%.

### The kernel contract

The kernel promises one interface to everything above it, and it is versioned (`kernel: ">=3.2"` in a package's requirements):

- `zeff.*` in functions, widgets and cells: data, meta, AI, call, chat, api, plus one namespace per driver.
- The view language and its elements.
- The flow node set.
- The extension points, which **accept stored contributions**. Today they only take what a TS module registers at import. Each
  point needs a stored form (a manifest entry that names a function or a view) next to its TS form. Several already have one (sources,
  lookups, field types, flow actions). The others are a short list below.
- The manifest schema and the package format.

A kernel update may add to the contract. It may only remove something after a deprecation that the package tests show nobody uses.

## How an update arrives

1. **Built-ins become packages** with the id `zeff.<plugin>`, shipped in a **feed**. *Decided (2026-11-13): the feed is the zeff-plugins
   repository.* A release of a package is a signed tag (`zeff.<plugin>@<version>`) there. Zeff reads the tags, fetches only what a
   signed tag points to, and ignores branches and untagged commits. On start, and when you ask for it, Zeff reads the feed and **offers** new versions. It doesn't apply
   them by itself.
2. **An update is applied the same way as Learn's:** install or update in place, run the declared migrations, run the package's tests,
   and roll back the whole update if any of them fails. History keeps the earlier version, and one click goes back.
3. **What you changed stays yours.** A shipped part you edited is an *overlay*. An update brings the new base and puts your change on
   top, with a three-way merge between the old base, the new base and yours. *Decided (2026-11-13): the merge works per field and per
   line, not per whole part.*
   - **Structured parts** are merged field by field, matched by a stable id, not by position or name. That covers a database's fields
     and views, a flow's nodes and edges, a package's manifest, a block's settings, and a view's elements and their attributes. Every
     part that is stored as structure needs stable ids for what's inside it. Where one is missing today, stage 1 adds it, with a
     migration that gives the existing parts their ids.
   - **Text** is merged line by line. That covers a view's template text, a function's code, a chat's rules and a page's text.
   - **A conflict** only happens where both sides changed the same field or the same lines. The update goes ahead with everything
     else and waits only for those spots. You see them side by side, and the AI proposes a resolution that you accept or change. The
     package's tests then run on the merged result, not on the new base alone.
4. **Signed.** Code from a feed runs with the rights its manifest asks for, so every release tag is signed. Zeff checks the signature
   against a public key that comes with the kernel. Only a kernel update can change that key. Access to the repository alone is not
   enough to ship code: a commit without a valid signed tag is never installed. A package from anywhere else is installed as today: switched off, and you grant what it needs.
5. **Kernel updates** stay ordinary releases (build, Drizzle migrations, restart). Before an update, Zeff checks which installed
   packages need a kernel version it doesn't have, and shows them.

## Safe mode, for everything

**Built (stage 0).** Safe mode is **one switch for everything stored** (`lib/kernel/safe-mode.ts`). While it is on:

- no mod runs;
- every external plugin reads as off, and its functions, hooks, schedules and contributions go with it;
- nothing starts by itself: no flows by clock or event, no routines, no pipelines.

You can still open your pages and their history, roll back and use the AI, which is how you repair what broke. What you had on comes
back when you leave. A bar on every page says that safe mode is on and why, and offers the way out.

Safe mode is switched on in one of three ways:

- by you, from that bar or the Mods page;
- by `ZEFF_SAFE_MODE=1`;
- by **the start guard** (`lib/kernel/boot-guard.ts`). Every start is written down with the step it is in. After two starts in a row
  that never got through their steps, Zeff comes up in safe mode by itself and names the step it stopped in. A start that got through
  and was then stopped or restarted (a dev server killed while it compiles) is never counted.

Mods can't hook `lib/kernel/`.

**Changed from the plan:** the plan said the one stored part that broke a start would be switched off by itself. What was built
switches **everything** stored off and names the step instead. Which part broke a start can only be guessed, and a wrong guess would
leave the broken part running. Without safe mode, "runtime updatable" would also mean "breakable at runtime" with no way back.

## The stages

Each stage ends with tests and docs, like the stages of Zeff in Zeff.

### 0. Contract and safe mode

- Write the kernel contract down and give it a version. *Done: [the kernel contract](kernel-contract.md), checked against the code
  by `tests/kernel-contract.test.ts`. Its version is the extension API version.*
*Stage 0 is done (2026-11-13).*

- Give stored forms to the extension points that lack one. *Done, through providers that extension points now take: formula functions,
  Kennzahlen, row badges, tab menus, widgets, page navigation, and review sources and links come from a plugin's manifest. Every point is
  classified in [the contract](kernel-contract.md): 13 stored, 5 covered another way, 3 kernel, 3 owner, none left to do. The test fails
  when a new point doesn't say which form it has.*
- Safe mode for all stored parts, with the automatic switch-on after failed starts. *Done, see above (`tests/safe-mode.test.ts`).*
- A test that starts Zeff in safe mode and repairs what broke. *Done: a flow brought back from its history, and a whole app taken back
  to the save point kept before the update that broke it, both while in safe mode.*

### 1. The update channel

- Built-ins as packages `zeff.<plugin>` in the zeff-plugins repository, released by signed tags. The kernel's public key, and the
  tag check (a test with a forged tag and an unsigned commit). The offer, the overlay merge per field and line (with stable ids
  inside every structured part, and the conflict view) and whole-update rollback.
- Kernel-version checks in package requirements.
- First real use: move Learn from "files installed by setup.ts" to "a package from the feed".

### 2. The bridge: mods in the database

*Decided (2026-11-13): the bridge is built.* The remaining TypeScript can't be ported in one go. Until it is, the Mods hooks make it
updatable anyway:

- Mods stored as database parts, with versions and the feed, like packages. They are built with the esbuild that ships with Zeff.
- A shipped **patch** is a mod pinned to the hash of the code it replaces. The hook catalog already holds back a hook written for
  other code.
- This is a bridge, not the goal. A patch has Zeff's own rights, so it comes only from the signed feed, and each port deletes the
  patches it no longer needs.

After stage 2, **every** change to Zeff can ship without a rebuild: a package version for what's ported, a patch for what isn't yet.
The stages after this one shrink the patch surface.

### 3. Port tier A: little or no UI

| Plugin | Lines | Note |
| --- | --- | --- |
| lang-de, lang-en, lang-es | 33 | Texts are data already (`bundle.json`). ✅ de and es are language packs in zeff-plugins now (runtime plugins, `contributes.language`); lang-en (overrides only) stays. |
| knowledge-hub, lookups, zeiterfassung, work-elevated | ~350 | |
| teams, google-calendar, web-search, revolut, outlook, gmail | ~1.8k | Their logic, over the mail/calendar/HTTP drivers. |
| auto-actions, jira, gitlab, work | ~2.9k | |
| correlations, entities, todos | ~3.5k | No UI of their own. |
| google-drive, imap-mail | ~2.5k | The IMAP connection becomes a driver, the rest is ported. |

About 11k lines and about 20 plugins. Each one is a few days. Expect a handful of new contract pieces, mostly driver capabilities.

### 4. Port tier B: apps of medium size

agenda, mail-client, loops, jira-lage, timeline, cases, finances, documents: about 14k lines. Each is roughly a Learn. Their screens
are views and widgets, their syncs are functions and schedules, and their AI tasks are functions with `zeff.ai`.

### 5. Port tier C: the heavy UIs

calendar (2.4k of UI), news (6.9k), people (8.4k), studio (2.8k of UI) and the Workspace's own screens (26k of UI). This is where the
cost is. The view language has to stay fast with large lists (virtual scrolling, rendering only what changed), and it may need a
component model of its own.

**Decided (2026-11-13): heavy UI is written in the view language.** It is the only language for screens above the line. The AI can
read it and repair it the same way everywhere, and it never gets more rights than a view has. Other options were considered and
not chosen: TSX stored in the database and built at runtime in the widget frame (faster to port, but a second UI language), and TSX
running in the page like a mod (full rights). Free-form widgets stay what they are today: single pieces inside a view, not a way to
write a whole app.

The view language has to grow before tier C. This is stage 5a, and each piece is general and stays in the kit:

- **Speed:** virtual scrolling for long lists and tables, rendering only what changed, and data loaded in pages.
- **Components:** views that take parameters and slots, can be reused across packages and have their own state, so a screen like
  People can be built from parts instead of being one template.
- **Layout and interaction:** split panes, resizable columns, context menus, a time grid (calendar) and a canvas with nodes and edges
  (Studio's flow editor; `<graph>` is a start).
- **Tools for the people who build views:** error messages that point to the template line, and a check in the package tests that
  every view still renders.

Each screen of tier C is ported once the pieces it needs are there. The order is the one with the fewest new pieces first: news,
people, calendar, then Studio and the Workspace's own screens.

### 6. Shrink the kernel

Once the tiers are done: move what is left of `src/components` and the Workspace UI that isn't a kit element above the line, delete the
patches, and measure the kernel. The goal is a kernel you can read in a week.

## Effort (a rough estimate)

Measured in "Learns", the size of the Learn port including the kit pieces it forced:

| Stage | Size |
| --- | --- |
| 0 Contract and safe mode | about 1 Learn |
| 1 Update channel | about 1½ Learns (the merge per field and line, and the stable ids it needs) |
| 2 Bridge | about ½ Learn |
| 3 Tier A | about 2 Learns |
| 4 Tier B | about 6–8 Learns |
| 5a View language grows | about 4–6 Learns |
| 5 Tier C | about 10–14 Learns |
| 6 Shrink | about 1–2 Learns |

Stages 0–2 alone give the goal's promise (every update without a rebuild), through patches for what isn't ported yet. The rest makes
it *clean*: open to the AI, sandboxed and repairable part by part.

## Risks

- **Code from a feed is code execution.** Signing, the rights a manifest declares, and the switched-off default are not optional.
- **Losing types.** Calls across packages need contracts that are checked at runtime (input and output schemas on functions), or bugs
  will show up only when someone uses the feature.
- **Debugging.** Error traces must name the stored part and its version, and *Repair with the AI* must get the trace.
- **Performance.** Functions run in containers. A hot path (a sync over thousands of mails) needs batch calls, or a driver that does
  the bulk work.
- **Two ways at once.** While a port is underway, the built-in and the package both exist. The parity rule decides when the built-in
  goes. Until then, both are tested.

## Open decisions

1. ~~The language for heavy UI~~: decided, the view language (stage 5).
2. ~~The feed~~: decided, the zeff-plugins repository with signed tags.
3. ~~The overlay merge~~: decided, per field (by stable id) and per line.
4. ~~Patches~~: decided, the bridge is built (stage 2). Each port deletes the patches it no longer needs.

All four are decided. The next step is stage 0.
