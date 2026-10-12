# Panels: your own views in Zeff

A panel is an HTML page of yours, shown **inside** Zeff in a sandboxed frame. It is plain web code — HTML, CSS,
JavaScript, no build step — plus a small library Zeff provides, `window.zeff`, to talk to Zeff.

## Declaring one

```json
"permissions": ["work.read"],
"contributes": {
  "workPanels": [
    { "id": "runs",    "title": "Runs",     "entry": "index.html",   "placement": "tab" },
    { "id": "details", "title": "Run info", "entry": "session.html", "placement": "session" }
  ]
}
```

- `placement: "tab"` — a link in **Work's sidebar** (under the sessions); opens a page of its own,
  `/ext/view/<plugin>/<panel>`.
- `placement: "session"` — an extra tab of **every session** next to *Conversation, Changes, Preview*. The panel is
  told which session it is shown for (`zeff.info.context`).

The files live in the plugin's **`ui/`** folder, and only there: `plugins/my-plugin/ui/index.html` is served as
`/ext/my-plugin/index.html`. Nothing outside `ui/` (rules, hook scripts, your storage) can be loaded by a panel.
Allowed file types: `html htm js mjs css json map txt md svg png jpg jpeg gif webp ico woff woff2 ttf`.

## The sandbox

A panel runs in an `<iframe sandbox="allow-scripts allow-forms allow-popups allow-modals">` **without `allow-same-origin`**,
and Zeff sends its files with a `Content-Security-Policy: sandbox …` header, so even opened
directly in a tab it has no origin of its own. Consequences:

- It **can't** read Zeff's page, its cookies, `localStorage` or other frames, and can't send requests to Zeff's
  API. `localStorage`/`sessionStorage`/cookies in a panel throw — use `zeff.storage` instead.
- It **can** run scripts, load files from its own `ui/` folder and `/ext/sdk/…`, use `data:` and `blob:` images and fonts.
- **Network:** `fetch`, XHR and WebSockets reach Zeff's own server only (`connect-src 'self'`). A plugin that
  declares the `network` permission may contact other websites with them. Scripts, styles, images and fonts are
  **never** loaded from other sites (`script-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:` …): bundle what
  you need into `ui/`. `eval` is not allowed.
- All talking to Zeff goes through `zeff.call(…)`: the panel posts a message, Zeff's page makes the request for it
  and the **server checks the plugin's permissions**, so a panel can only do what the plugin was granted.

## Using Zeff's library

Add two lines to your page:

```html
<link rel="stylesheet" href="/ext/sdk/zeff.css">
<script src="/ext/sdk/zeff.js"></script>
```

`/ext/sdk/zeff.css` gives the page Zeff's colours (light and dark follow the system, like Zeff) and a few
classes — `.card`, `.btn`, `.btn-primary`, `.input`, `.badge`, `.row`, `.muted`, `.ok`, `.warn`, `.bad`, tables —
plus the variables `--zeff-bg`, `--zeff-fg`, `--zeff-muted`, `--zeff-card`, `--zeff-line`, `--zeff-accent`,
`--zeff-ok`, `--zeff-warn`, `--zeff-bad`. Use your own CSS if you prefer.

`/ext/sdk/zeff.js` defines `window.zeff`. Every call returns a promise that rejects with an `Error` whose `code` is the
API's error code (`permission`, `bad_request`, …).

```js
zeff.ready        // Promise: { apiVersion, plugin, account, permissions, ungranted, context }
zeff.info         // the same, once ready
zeff.call(method, params)

zeff.on("change", ({ topic }) => …)   // Zeff changed: topic is "work", "todos", "attention" or "kanban"
zeff.off("change", fn)

zeff.storage.get(key) / .set(key, value) / .delete(key) / .keys()

zeff.work.runs.list({ limit, status, ticket, todoId })
zeff.work.runs.get(id)
zeff.work.runs.log(id, from)
zeff.work.runs.cancel(id)
zeff.work.sessions.start({ instruction, ticket, repoId, provider })
zeff.work.sessions.send(runId, message)

zeff.todos.list({ status, ticket, limit })
zeff.todos.add({ text, ticket })

zeff.ui.toast(message, tone)       // tone: "info" (default) or "error"
zeff.ui.navigate("/work?run=3")    // a page of Zeff — not /api, not /ext, not another site
zeff.ui.openSession(runId)
zeff.ui.resize(height)             // session panels: their height in pixels (tab panels fill the page)
```

The methods and what they return are in [api](api.md). Anything not listed as a helper is reachable with
`zeff.call("name", params)`.

### Context

`zeff.ready.then(info => info.context)` tells the panel where it is shown:

| Placement | `context` |
| --- | --- |
| `tab` | `{}` — or `runId`, `ticket`, `todoId` when the page was opened with `?runId=…&ticket=…&todoId=…` |
| `session` | `{ runId, ticket, todoId }` of the session it is shown in |

### Live updates

`zeff.on("change", …)` fires when something in Zeff changes (a run starts or ends, a todo changes), with the topic
as a hint, not the data. Ask again for what you show — and don't ask more often than needed:

```js
let t;
zeff.on("change", ({ topic }) => {
  if (topic !== "work") return;
  clearTimeout(t);
  t = setTimeout(load, 300);          // many changes arrive in bursts
});
```

## A complete small panel

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/ext/sdk/zeff.css">
<div class="row">
  <input id="what" class="input" style="flex:1" placeholder="What should a worker do?">
  <button id="go" class="btn btn-primary">Start</button>
</div>
<table id="runs"></table>
<script src="/ext/sdk/zeff.js"></script>
<script>
  const $ = (id) => document.getElementById(id);
  async function load() {
    const runs = await zeff.work.runs.list({ limit: 15 });
    $("runs").innerHTML = "<tr><th>Run</th><th>Status</th><th>Ticket</th></tr>" +
      runs.map((r) => `<tr><td><a href="#" data-id="${r.id}">${r.ref}</a></td><td>${r.status}</td><td>${r.ticket || ""}</td></tr>`).join("");
  }
  $("runs").onclick = (e) => { const id = e.target.dataset?.id; if (id) { e.preventDefault(); zeff.ui.openSession(Number(id)); } };
  $("go").onclick = async () => {
    try { const { runId } = await zeff.work.sessions.start({ instruction: $("what").value }); zeff.ui.openSession(runId); }
    catch (err) { zeff.ui.toast(err.message, "error"); }
  };
  zeff.on("change", ({ topic }) => topic === "work" && load());
  load().catch((err) => ($("runs").textContent = err.message));   // e.g. no work.read permission
</script>
```

(Escape data you put into `innerHTML` — run summaries and ticket texts come from outside. `textContent` is safer.)

## Tips

- **Debugging:** right-click the panel → *Inspect* (it's an ordinary frame), or open `/ext/<plugin>/<file>` directly in
  a tab to see the page; it works with `zeff.*` calls only inside Zeff.
- **Reloading:** files are read from disk on every load — edit, then reload the frame (or the page).
- **Several panels** of one plugin share its `zeff.storage`.
- **Inline is fine:** inline `<script>`, `<style>` and event attributes work; remote scripts and `eval` don't.
