# Mods

Zeff has two ways to be extended:

| | Plugins | Mods |
| --- | --- | --- |
| What they do | work **inside** Zeff — apps, server functions, flows, views, chats | change **Zeff itself** — any of its functions and components |
| How | a manifest of contributions ([plugins](plugins/manifest.md)) | hooks on Zeff's own code |
| Rights | sandboxed: what you grant | Zeff's own — on only when you switch it on |
| Where | `data/plugins/<id>/` (or a GitHub source) | `data/mods/<id>/` |
| Page | Plugins | Plugins → **Mods** (`/mods`) |

A mod changes how Zeff behaves or looks **without touching Zeff's code**, and without a rebuild: it works the same in the
release (which has no sources and can't be rebuilt) as in a checkout.

## Hooks

When Zeff is built, every exported function and component of `src/` is put behind a **hook** — a `Proxy` that, with no mod on it,
only calls the original. The source stays as it is; only the build changes (a Turbopack loader, `scripts/mods/hook-loader.cjs`).
Each hook is named by its file below `src/` and its export name:

```
plugins/workspace/store#updateSchema        a function (server)
plugins/workspace/ui/PageView#PageView      a component (browser, and server rendering)
app/settings/page#SettingsHubPage           a server component
```

About 5,000 hooks; the catalog (`zeff-hooks.json`, beside the build) lists each with its kind, parameters, side, place and the hash
of its code. Not hooked: files with `"use server"` / `"use cache"` (Next compiles their exports itself), Next's own functions
(`generateMetadata` …, `proxy`, `instrumentation`), and what is no function. What happens *inside* a function can't be hooked —
wrap the function and change what goes in or comes out; where that is not enough, Zeff needs a hook point of its own there.

`ZEFF_MOD_HOOKS=0` builds Zeff without hooks (exactly as written).

## A mod

```
data/mods/sidebar-clock/
  zeff-mod.json   { "id": "sidebar-clock", "name": "Sidebar clock", "version": "1.0.0", "description": "…",
                    "client": "client.tsx", "server": "server.ts", "css": "style.css" }
  client.tsx      runs in the browser (and where a client component renders on the server)
  server.ts       runs on the server
  style.css       for the whole app
```

Each part exports one function that registers what it does:

```tsx
// client.tsx
import { useState } from "react";
export default (mod) => {
  mod.wrap("components/SiteHeader#SiteHeader", (Orig) => (props) => {
    const [n, setN] = useState(0);
    return (<><div onClick={() => setN(n + 1)}>clicked {n}</div><Orig {...props} /></>);
  });
};

// server.ts
export default (mod) => {
  mod.before("plugins/workspace/store#updatePage", (args) => args);              // change the arguments
  mod.after("lib/attention#listAttention", async (items) => items.slice(0, 5));   // change the result
  mod.around("some/file#fn", (next, ...args) => next(...args));                   // around it
  mod.replace("some/file#fn", (...args) => 42);                                   // instead of it
};
```

- `react` is **Zeff's own React** (handed in, never bundled): a mod's components draw with the React they are drawn in, hooks and all.
  A server part may import Node's modules (`node:fs` …). Nothing else from outside the mod's folder — no npm packages; several files
  of its folder are bundled together.
- A mod is built by **esbuild** (it ships with Zeff) into `.build/` when it is saved or switched on, and loaded at runtime: the server
  parts with `vm` on the server, the browser parts as a script in the page's `<head>` (before React starts — so the server and the
  browser draw the same, no hydration mismatch).

## Nothing a mod does may break Zeff

- **Guarded hooks.** A `before` / `after` / `around` / `replace` that throws is passed by — the original runs, or its result is kept
  (an `around` that throws after calling the original never runs it twice). A wrapped component that throws is replaced by the original:
  in the browser by an error boundary, on the server (server components and server rendering have no boundaries) by calling it guarded.
- **Switched off when failing.** A mod whose hooks fail 5 times is switched off — on the server written down at once, in the browser told
  to the server — with the reason and its errors on the Mods page.
- **Held back when Zeff changes.** A mod records the hash of each hook's code it names (filled in on save, from the catalog). When an update
  of Zeff changes that function, the hook is **held back**, not applied, and the Mods page says which — adapt the mod.
- **On only when you say.** A mod you or the AI save starts off; switching one on is your approval (it runs with Zeff's rights). A change
  the AI makes switches it off until you look at it again.
- **Versions.** Every save keeps the files before (`.versions/`, the last 30); one can be brought back. Removing a mod moves it aside
  (`data/mods/.removed/`).
- **Safe mode.** 🛟 on the Mods page (or `ZEFF_SAFE_MODE=1`, or by itself after two starts in a row that didn't come up): Zeff runs
  without any mod until you leave it. It is Zeff's one safe mode ([the kernel](zeff-kernel.md#safe-mode-for-everything)): external
  plugins and what starts by itself are off too, and a bar on every page shows it. No mod can hook `lib/kernel/`.

## Patches from a repository

A plugin repository can hold mods beside plugins (a folder with `zeff-mod.json`). These are **patches** to Zeff itself, shipped
without a rebuild ([the kernel's stage 2](zeff-kernel.md#2-the-bridge-mods-in-the-database), `src/lib/mods/feed.ts`):

- **Only signed.** A patch runs with Zeff's own rights, so it is installed from a source only as a signed release
  ([signed releases](plugins/repository.md#signed-releases)). An unsigned patch, or one changed after signing, is refused.
- **Like a plugin update.** A newer version shows in the update notes. *Update* installs it, builds it and loads it at once. A new
  patch comes on with your click, and an update keeps it on or off as you had it. The version before is kept.
- **Pinned to the code it was written for.** Its `targets` (the hash of each hook's code) are part of what was signed. When a Zeff
  update changes that code, the hook is held back by itself.

## For your case: point, say, try, keep or undo

The way a change you want reaches Zeff — *"this would work better for me"* — without leaving the page:

1. **Point at it.** 👆 *Point at it* in the Workspace assistant: the element under the mouse is outlined, a click takes it (and presses
   nothing). The assistant is told the element, its text, the hooked components that draw it (innermost first, from React's own tree —
   every exported component is a named hook) with the simple values they were given (a page's id, a view's name), and the `data-*` marks
   around it (`src/lib/mods/pick.ts`).
2. **Say what would work better.** The assistant takes the smallest change that does it: what you built (a view, its template, a widget,
   a block, fields, a flow) → a plugin's app or function → a mod, only when Zeff itself must change (a built-in page, a menu, a component
   you didn't build). It says what it changed and where you see it.
3. **Try it.** A mod it wrote comes as a card under its answer — *Switch on and try* (your approval) loads the page again with it.
4. **Keep it, or undo it.** *Undo what this answer changed* takes back everything the answer did: pages, a flow's or a database's fields'
   version, a plugin function's code, a block, a mod (a new one moved aside, a changed one back to its version before — and on again if it
   was on). Keeping it is doing nothing.

**Only where you asked.** A mod the AI makes is for the account you are in (Zeff more than once — work, private); other accounts stay as
they are. On the Mods page each mod says *Every account* or *Only “…”* (the browser part is only sent to its accounts' pages, the server
part runs only in calls made for them). The AI makes one for every account only when you say so.

**After an update of Zeff.** A hook whose code changed (or is gone) is held back — seen from the catalog at once, not only when it is
called. *Adapt with the AI* on the Mods page has the assistant read the new code, adapt the mod and save it; you switch it on again.

## For the AI

The Workspace assistant (and Zeff's MCP) has `workspace_mod_docs`, `workspace_mod_hooks` (find a hook, read its code where Zeff's sources
are), `workspace_mods` (state, errors, held-back hooks), `workspace_mod_read` and `workspace_mod_save` (written and built; stays off for
you to switch on — from the card under the answer; `for: "this" | "all"` says which accounts, a new one is for the account you are in). Ask it: *"make a mod that shows the week number in the header"*.

## Code

`scripts/mods/analyze.cjs` (what is hooked, the transform), `hook-loader.cjs` (the build loader), `catalog.cjs` (zeff-hooks.json);
`src/lib/mods/hook.ts` (the runtime: hooks, guards, held back, safe mode), `store.ts` (the mods' folders, state, versions), `build.ts`
(esbuild), `server.ts` (loading), `page.ts` (what a page brings), `actions.ts`, `mcp.ts`, `pick.ts` (pointing), `requests.ts` (adapt with the AI);
`src/app/mods/page.tsx`; the card in the chat: `src/plugins/workspace/ui/mod-embed.tsx`; Undo beside the pages: `UndoExtra` in
`src/plugins/workspace/undo.ts`. Tests:
`tests/mods.test.ts`.
