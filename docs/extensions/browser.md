# Browser

> Lets Zeff's AI open public web pages in an automated Chrome of its own — pages that only load with JavaScript too — read their text, links and pictures, and click and type on them; as an MCP tool for agents and in the Workspace chat. **Category:** Connector · **On by default:** no · **Beta:** yes · **Needs:** Chrome or Edge installed on this computer

No screenshot: the extension has no page of its own. It shows up as the tool group *Use a browser* of the Workspace
chat and as the MCP tool `browser_open`.

## For users

### What it does

[Web search](web-search.md)'s `web_fetch` reads a page's HTML as it comes from the server. Many pages show nothing
until JavaScript has run (shops, film databases, single-page apps), or need a click (a cookie banner, "show more", a
search field). The Browser extension gives the AI a real, headless Chrome for that: it opens the page, does up to ten
steps — click, fill in, press a key, wait, scroll — and reads what is there: the visible text, the main picture, up to
20 larger pictures and up to 60 links.

Each call is a browser of its own with an empty profile, closed afterwards: no logins, no cookies, nothing of this
computer.

**Beta:** it browses for you with Chrome's normal User-Agent, but a page can still refuse it or ask for a human check
(IMDb does); Zeff doesn't get round that. The AI acts on its own on public websites: it can click and fill in forms
there, though it has none of your logins. Pages on your computer or your own network stay out of reach.

### Getting started

1. Have Google Chrome or Microsoft Edge installed (Zeff tries Chrome, then Edge, then Playwright's own Chromium).
2. Menu → Plugins → category *Connector* → switch on **Browser** (it carries the *beta* label).
3. In the Workspace chat, the tool group **Use a browser** ("An automated Chrome on public websites: read, click, type —
   it can leave traces there") is **off by default** for an agent: turn it on where you want the chat or an agent to
   browse. Agents over MCP see the tool `browser_open` while the extension is on.

### Using it

Ask the Workspace chat something that needs a live page — "open the cinema's programme page and list today's
showings", "search the shop for this part number and tell me the price". The AI calls `browser_open` with the address
and, if needed, steps such as:

```json
{ "url": "https://example.org/search", "steps": [
  { "action": "fill", "target": "input[name=q]", "text": "Dune" },
  { "action": "press", "text": "Enter" },
  { "action": "wait", "target": "Results" }
] }
```

A step's `target` is a CSS or XPath selector, or the visible words on the element. The answer gives the final address,
the HTTP status, the title, the text (12 000 characters by default, up to 40 000), the main picture, pictures with their
size and links.

### Settings

None. Whether the chat may use it is the tool group *Use a browser* of the chat / agent; whether agents over MCP may is
the extension's on/off switch.

### Tips & limits

- **What leaves the machine:** this computer visits the page like a person would; the site sees a normal Chrome on this
  computer (its real version and system, without "Headless"). Everything the page loads goes through the same address
  check — the machine's own and private addresses are refused before the browser starts and for every request the page
  makes; WebSockets are closed; downloads and service workers are blocked.
- **It can leave traces:** clicking and typing on a public site can submit a form there. Keep the tool group off where
  you don't want that.
- One browser at a time (calls queue); a call ends after 60 seconds at most; a step waits at most 8 seconds.
- At most 10 steps per call; pictures smaller than 64×64 pixels are left out.
- No logins: pages behind a sign-in show what a stranger would see.

## Technical reference

### Overview

[browse.ts](../../src/plugins/browser/browse.ts) — `browserOpen(url, { steps, maxChars })`:

1. `publicUrl(url)` from [Web search](web-search.md) checks the address (http/https, resolves to a public address).
2. Waits for the previous call (one Chrome at a time, a global promise chain).
3. Launches Chrome through `playwright-core` (`channel: "chrome"`, then `msedge`, then the bundled one), headless; a
   60-second timer closes it.
4. New context: `acceptDownloads: false`, `serviceWorkers: "block"`, the browser's own User-Agent with `HeadlessChrome`
   replaced by `Chrome`. Every http(s) request is routed through the address check (cached per host), blocked requests
   are aborted; WebSockets are closed.
5. `goto` (DOM content loaded, 30 s), a short wait for network idle, the steps (`click`, `fill`, `press`, `wait`,
   `scroll` — `locate` takes CSS/XPath or visible text), then reads title, `innerText`, `og:image` / `twitter:image`,
   images ≥ 64×64 sorted by size (20), links with text (60).
6. Closes the browser.

[mcp.ts](../../src/plugins/browser/mcp.ts) registers `browser_open` on Zeff's MCP server; the Workspace chat's tool
group `web.browser` ([workspace/agent-tools.ts](../../src/plugins/workspace/agent-tools.ts)) exposes it to the chat.

### Manifest

| Field | Value |
| --- | --- |
| id | `browser` |
| name | Browser |
| category | `connector` |
| order | 126 |
| defaultInstalled | `false` |
| beta | "It browses for you with Chrome's normal User-Agent, but a page can still refuse it or ask for a human check (IMDb does) …" |
| requires | "Chrome or Edge installed on this computer." |
| dependsOn, settings, routes, syncSteps, features | — |

### Files

| File | What it is |
| --- | --- |
| [plugin.ts](../../src/plugins/browser/plugin.ts) | The manifest. |
| [browse.ts](../../src/plugins/browser/browse.ts) | `browserOpen`: launch, guard, steps, read. `MAX_STEPS = 10`. |
| [mcp.ts](../../src/plugins/browser/mcp.ts) | The MCP tool `browser_open`. |
| [web-search/search.ts](../../src/plugins/web-search/search.ts) | `publicUrl` — the address check it reuses. |

### Data

None. Each call uses a fresh, empty browser profile that is discarded.

### Sync, jobs & AI tasks

None.

### MCP tools & actions

| Tool | Input | Output |
| --- | --- | --- |
| `browser_open` | `url`; `steps` (≤ 10): `{ action, target?, text? }` with action `click`, `fill`, `press`, `wait` or `scroll`; `maxChars` 1000–40000 | Final URL, status, title, text (cut-off marked), main image, images, links. |

While the extension is off: "The Browser plugin is not installed in Zeff (Menu → Plugins) — this tool isn't available."

### Extension points

None. It depends on Web search's `publicUrl` for the address check (imported, not a point).

### Tests

| Test | Covers |
| --- | --- |
| [tests/browser-plugin.test.ts](../../tests/browser-plugin.test.ts) | Private addresses refused before a browser starts; a real page with JavaScript, its main picture, links and a step; sub-requests to private hosts blocked. |

Run: `node --import tsx --test tests/browser-plugin.test.ts` (the browser tests need Chrome or Edge).
