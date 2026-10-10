#!/usr/bin/env node
/**
 * keep-mcp — a stdio MCP server that reads your Google Keep notes for Zeff with Playwright,
 * deterministically (no LLM) and read-only. It ATTACHES to the automation Chrome (the account's —
 * KEEP_CDP_ENDPOINT, else ROAR_CDP_ENDPOINT, default http://127.0.0.1:9222), where your Google
 * session signs Keep in — no password is ever handled here.
 *
 * How it reads: it opens Keep in a fresh tab and LISTENS to what Keep's own web app loads there —
 * its notes, page by page (notes-pa.clients6.google.com/notes/v1/changes) — then closes the tab.
 * It sends Google nothing of its own and changes nothing: no note is opened, edited or moved.
 *
 * Tools:
 *   keep_status          -> is Chrome reachable, is Keep (Google) signed in
 *   keep_notes {account} -> the notes (title, text, list items, labels, pinned, archived, colour,
 *                           created, edited) — trashed ones left out
 *   keep_write {op, …}   -> a note written in Keep's own editor (create / update / trash — see
 *                           write.mjs), returned as Keep then saved it. The only tool that changes Keep.
 */
import { connectToChrome, ChromeConnectError, withTabLock } from "../../../scripts/chrome-cdp.mjs";
import { decodeModel, itemsToText, textToItems } from "./model.mjs";
import { createNote, trashNote, updateNote } from "./write.mjs";

const CDP = process.env.KEEP_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const log = (...a) => process.stderr.write(`[keep-mcp] ${a.join(" ")}\n`);
const debug = (...a) => process.env.KEEP_DEBUG && log(...a);

/** An account: Google's number (u/<n>) or the address (Keep then goes to that account). */
const keepUrl = (account = 0) =>
  /^\d+$/.test(String(account)) ? `https://keep.google.com/u/${account}/` : `https://keep.google.com/?authuser=${encodeURIComponent(String(account))}`;
const isKeep = (u) => /^https:\/\/keep\.google\.com\//i.test(u);
const isLogin = (u) => /accounts\.google\.com|ServiceLogin|signin/i.test(u);
const CHANGES = /\/notes\/v1\/changes(\?|$)/;
/** "Not set" in Keep's timestamps. */
const never = (t) => !t || t.startsWith("1970-01-01");

/**
 * The labels' names: Keep's page carries them as data (`{"name":…,"mainId":…}`, its quotes
 * escaped as \x22) — the notes only name a label's id.
 */
function labelsFromHtml(html, into) {
  const text = html.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  for (const m of text.matchAll(/"mainId":"([^"\\]+)"/g)) {
    const around = text.slice(Math.max(0, m.index - 400), m.index + 400);
    const at = m.index - Math.max(0, m.index - 400);
    let best = null;
    for (const n of around.matchAll(/"name":"((?:[^"\\]|\\.)*)"/g)) if (!best || Math.abs(n.index - at) < Math.abs(best.index - at)) best = n;
    if (!best || into.has(m[1])) continue;
    try {
      into.set(m[1], JSON.parse(`"${best[1]}"`));
    } catch {
      into.set(m[1], best[1]);
    }
  }
}

/** A note (or list) from Keep's nodes, with its list items; null when it's trashed or deleted. */
function toNote(n, items, labels, number) {
  const t = n.timestamps || {};
  if (!never(t.trashed) || !never(t.deleted)) return null;
  // The content: newer notes as commands (replayed — a checklist with its ticks), older ones as text and LIST_ITEM nodes.
  const model = decodeModel(n);
  const legacy = (items.get(n.id) || [])
    .filter((i) => never(i.timestamps?.deleted))
    .sort((a, b) => Number(b.sortValue || 0) - Number(a.sortValue || 0))
    .map((i) => ({ text: String(i.text ?? ""), checked: !!i.checked }));
  const list = model?.list ? model.items : legacy;
  // A checklist as "- [ ]" / "- [x]" lines (as Zeff writes its own); a note's text as it is.
  const text = n.type === "LIST" || model?.list ? itemsToText(list) || String(n.indexableText ?? "") : String(model?.text || n.indexableText || n.text || "");
  const id = n.serverId || n.id;
  return {
    id,
    kind: n.type === "LIST" ? "list" : "note",
    title: String(n.title ?? ""),
    text,
    items: list,
    // A label taken off stays listed, marked deleted.
    labels: (n.labelIds || []).filter((l) => never(l.deleted)).map((l) => labels.get(l.labelId) || null).filter(Boolean),
    color: n.color && n.color !== "DEFAULT" ? String(n.color).toLowerCase() : null,
    pinned: !!n.isPinned,
    archived: !!n.isArchived,
    createdAt: never(t.created) ? null : t.created,
    updatedAt: never(t.userEdited) ? (never(t.updated) ? null : t.updated) : t.userEdited,
    url: `https://keep.google.com/u/${number}/#${n.type === "LIST" ? "LIST" : "NOTE"}/${encodeURIComponent(id)}`,
  };
}

async function keepNotes({ account = 0, launch = false, timeoutMs = 120000 } = {}) {
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [keepUrl(account)] : [] });
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  // A fresh tab: Keep's app then loads all notes (an open one only asks for what changed).
  const page = await context.newPage();
  const nodes = new Map();
  const labels = new Map();
  let full = null;
  let done = false;
  let pages = 0;
  let lastAt = Date.now();
  page.on("response", async (r) => {
    if (!CHANGES.test(r.url()) || r.request().method() !== "POST") return;
    try {
      const j = await r.json();
      pages++;
      lastAt = Date.now();
      if (full === null) full = j.incremental !== true;
      for (const l of j.userInfo?.labels || []) if (l.mainId && l.name && never(l.timestamps?.deleted)) labels.set(l.mainId, String(l.name));
      for (const n of j.nodes || []) nodes.set(n.id, n);
      if (j.truncated !== true) done = true;
      debug(`changes page ${pages}: ${j.nodes?.length ?? 0} nodes, truncated ${j.truncated}`);
    } catch (e) {
      debug(`changes: ${e}`);
    }
  });
  try {
    await page.goto(keepUrl(account), { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`opening Keep: ${e}`));
    const start = Date.now();
    while (!done) {
      if (isLogin(page.url())) throw new Error("Keep shows Google's sign-in — sign in in the automation Chrome, then sync again.");
      if (Date.now() - start > timeoutMs) throw new Error(pages ? `Keep didn't finish loading its notes (${pages} pages so far).` : "Keep didn't load any notes (still loading? signed in?).");
      // Nothing new for a while after some pages: Keep has what it wanted.
      if (pages && Date.now() - lastAt > 15000) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!labels.size) labelsFromHtml(await page.content().catch(() => ""), labels);
    const number = /\/u\/(\d+)\//.exec(page.url())?.[1] ?? (/^\d+$/.test(String(account)) ? String(account) : "0");
    const items = new Map();
    for (const n of nodes.values()) if (n.type === "LIST_ITEM") items.set(n.parentId, [...(items.get(n.parentId) || []), n]);
    const notes = [...nodes.values()]
      .filter((n) => n.parentId === "root" && (n.type === "NOTE" || n.type === "LIST"))
      .map((n) => toNote(n, items, labels, number))
      .filter(Boolean);
    return JSON.stringify({ notes, full: full === true && done, pages });
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * A change in Google Keep (only on your click in Zeff): Keep opened in a fresh tab (all notes
 * loaded, so the note's current state is known), the change made in Keep's own editor, then what
 * Keep's app sends back for it awaited — the note returned as Keep has it now.
 */
async function keepWrite({ op, account = 0, id, kind, title, text, list, color, labels, pinned, archived, current = null } = {}) {
  if (!["create", "update", "trash"].includes(op)) throw new Error(`Unknown op "${op}".`);
  if (op !== "create" && !id) throw new Error("Which note? (id)");
  const browser = await connectToChrome(CDP, { launchUrls: [keepUrl(account)] });
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  const page = await context.newPage();
  const nodes = new Map();
  const after = new Map();
  const labelNames = new Map();
  let loaded = false;
  let t0 = Infinity;
  // Keep's saves after the change: each request carrying notes, until Google answered it. Keep keeps
  // nothing in the browser — a tab closed before they're through loses them.
  const saving = new Set();
  let saves = 0;
  let lastSaved = 0;
  // What Keep sent of each note (its latest fields): its own record of the note's state.
  const sent = new Map();
  page.on("request", (r) => {
    if (!CHANGES.test(r.url()) || r.method() !== "POST" || Date.now() < t0) return;
    try {
      const sentNodes = JSON.parse(r.postData() || "{}").nodes || [];
      if (sentNodes.length) {
        saving.add(r);
        saves++;
        // Each save carries the whole note (a label taken off: no labelIds at all) — the latest one as it is.
        for (const n of sentNodes) sent.set(n.id, n);
      }
    } catch {
      // not a save
    }
  });
  const settled = (r) => {
    if (saving.delete(r)) lastSaved = Date.now();
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", (r) => {
    if (saving.has(r)) debug(`a save failed: ${r.failure()?.errorText}`);
    settled(r);
  });
  page.on("response", async (r) => {
    if (!CHANGES.test(r.url()) || r.request().method() !== "POST") return;
    try {
      const j = await r.json();
      for (const l of j.userInfo?.labels || []) if (l.mainId && l.name) labelNames.set(l.mainId, String(l.name));
      for (const n of j.nodes || []) {
        nodes.set(n.id, n);
        if (Date.now() >= t0) after.set(n.id, n);
      }
      if (j.truncated !== true) loaded = true;
    } catch {
      // not ours
    }
  });
  try {
    await page.goto(keepUrl(account), { waitUntil: "domcontentloaded", timeout: 60000 });
    for (let i = 0; i < 120 && !loaded; i++) {
      if (isLogin(page.url())) throw new Error("Keep shows Google's sign-in — sign in in the automation Chrome, then try again.");
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!loaded) throw new Error("Keep didn't finish loading its notes.");
    labelsFromHtml(await page.content().catch(() => ""), labelNames);
    const number = /\/u\/(\d+)\//.exec(page.url())?.[1] ?? "0";
    const items = (n) => [...nodes.values()].filter((x) => x.parentId === n.id && x.type === "LIST_ITEM");
    const asNote = (n) => toNote(n, new Map([[n.id, items(n)]]), labelNames, number);
    // The note as Keep's sync has it — or (a note this browser wrote, not sent again) as Zeff has it.
    const target = id ? [...nodes.values()].find((n) => n.serverId === id || n.id === id) : null;
    const now = target ? asNote(target) : current;
    const noteKind = kind ?? now?.kind ?? "note";
    t0 = Date.now();
    let seen = null;
    if (op === "create") seen = await createNote(page, { title, text, list, color, labels, pinned, archived });
    else if (op === "update") seen = await updateNote(page, { id: target?.serverId || id, kind: noteKind, title, text, list, color, labels, pinned, archived }, now ?? {});
    else await trashNote(page, { id: target?.serverId || id, kind: noteKind }, now ?? {});
    // The note as Keep's saves last sent it — and whether that is what was asked for. Keep sends some
    // changes late (a trash only once its undo bar is gone), so only that state counts as done.
    const sentNote = () => {
      // (A note this tab didn't load — Keep may hand a fresh tab only what changed — by its serverId.)
      if (op !== "create") return (target && sent.get(target.id)) || [...sent.values()].find((n) => n.serverId === id) || null;
      const made = [...sent.values()].filter((n) => n.parentId === "root" && (n.type === "NOTE" || n.type === "LIST"));
      return made.at(-1) ?? null;
    };
    const asAsked = (n) => {
      if (!n) return false;
      if (op === "trash") return !never(n.timestamps?.trashed);
      if (pinned !== undefined && !!n.isPinned !== !!pinned) return false;
      if (archived !== undefined && !!n.isArchived !== !!archived) return false;
      return true;
    };
    // Until Keep's saves are through: at least one, none open, a few quiet seconds — and the asked state sent.
    for (let i = 0; i < 180; i++) {
      if (saves > 0 && saving.size === 0 && Date.now() - lastSaved > 4000 && asAsked(sentNote())) break;
      // Nothing sent yet after a while: back to the notes (Keep saves when an editor closes, a trash when its undo bar goes).
      if (i === 30 && !asAsked(sentNote())) await page.evaluate(() => (location.hash = "")).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
    const confirmed = saves > 0 && saving.size === 0 && asAsked(sentNote());
    debug(`${saves} save(s) sent, ${saving.size} unanswered`);
    if (op === "trash") return JSON.stringify({ ok: confirmed, confirmed, trashed: confirmed });
    // The note's id from what came back (a new note's serverId is Google's answer to the save).
    // A new note: the one Keep's own saves made (a top-level NOTE / LIST it sent), by its client id.
    const made = op === "create" ? [...sent.values()].filter((n) => n.parentId === "root" && (n.type === "NOTE" || n.type === "LIST")) : [];
    if (made.length > 1) debug(`${made.length} new notes sent — taking the last`);
    const back =
      op === "create"
        ? made.length && { ...(nodes.get(made.at(-1).id) ?? {}), ...(after.get(made.at(-1).id) ?? {}), id: made.at(-1).id, type: made.at(-1).type, parentId: "root" }
        : [...after.values()].find((n) => n.id === target?.id || n.serverId === id);
    const serverId = back?.serverId || (op === "create" ? null : id);
    // As Keep has it: title and text as its editor showed them, colour / pin / archive / labels from its answer.
    // Colour, pin, archive, labels: as Keep last sent them (over its answer, which may be a step behind).
    const last = back ? sent.get(back.id) : null;
    const answered = back ? asNote({ ...(last ?? back), serverId: back.serverId || last?.serverId, id: back.id }) : null;
    const listNow = seen?.list ?? (list ?? noteKind === "list");
    const wanted = {
      id: serverId,
      kind: listNow ? "list" : "note",
      title: seen?.title ?? answered?.title ?? now?.title ?? "",
      text: seen?.text ?? now?.text ?? "",
      labels: answered ? answered.labels : (now?.labels ?? []),
      color: answered ? answered.color : (now?.color ?? null),
      pinned: answered ? answered.pinned : (now?.pinned ?? false),
      archived: answered ? answered.archived : (now?.archived ?? false),
      createdAt: answered?.createdAt ?? now?.createdAt ?? new Date().toISOString(),
      updatedAt: answered?.updatedAt ?? new Date().toISOString(),
      url: serverId ? `https://keep.google.com/u/${number}/#${listNow ? "LIST" : "NOTE"}/${encodeURIComponent(serverId)}` : "",
    };
    return JSON.stringify({ ok: confirmed && !!serverId, confirmed, note: serverId ? wanted : null });
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function keepStatus() {
  let browser;
  try {
    browser = await connectToChrome(CDP, {});
  } catch (e) {
    return JSON.stringify({ chrome: false, signedIn: false, message: String(e?.message || e) });
  }
  try {
    const pages = browser.contexts()[0]?.pages() ?? [];
    const kp = pages.find((p) => isKeep(p.url()));
    if (kp) return JSON.stringify({ chrome: true, open: true, signedIn: !isLogin(kp.url()) });
    // Not open: Google's session tells (Keep signs in with it).
    const ctx = browser.contexts()[0];
    if (!ctx) return JSON.stringify({ chrome: true, open: false, signedIn: false });
    const r = await ctx.request.get("https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://keep.google.com", { timeout: 20000 }).catch(() => null);
    const signedIn = !!r && /@/.test(await r.text().catch(() => ""));
    return JSON.stringify({ chrome: true, open: signedIn, signedIn });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "keep_status", description: "Check whether Chrome (with the debug port) is reachable and Google Keep is signed in.", inputSchema: { type: "object", properties: {} } },
  {
    name: "keep_write",
    description:
      "Write a note in Google Keep through Keep's own editor (a fresh tab of the automation Chrome): op create | update | trash. Fields: id (update/trash), kind (note|list), title, text (a checklist as '- [ ] …' / '- [x] …' lines with list: true), color (red, orange, yellow, green, teal, blue, cerulean, purple, pink, brown, gray, default), labels (the full set), pinned, archived. Returns JSON { ok, confirmed, note? } — the note as Keep saved it.",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create", "update", "trash"] },
        account: { type: ["number", "string"] },
        id: { type: "string" },
        kind: { type: "string", enum: ["note", "list"] },
        title: { type: "string" },
        text: { type: "string" },
        list: { type: "boolean" },
        color: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        pinned: { type: "boolean" },
        archived: { type: "boolean" },
        current: { type: "object", description: "The note as Zeff has it (update/trash) — used when Keep's sync doesn't send it again (a note this browser wrote)." },
      },
      required: ["op"],
    },
  },
  {
    name: "keep_notes",
    description:
      "Read your Google Keep notes — read-only: opens Keep in a fresh tab of the automation Chrome, keeps what Keep's web app loads there (notes, lists, labels, pinned, archived), closes the tab. Trashed notes are left out. Returns JSON { notes, full, pages }.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: ["number", "string"], description: "Google's account: its number (u/<n>, default 0) or its address." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default false)." },
      },
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "keep", version: "0.1.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "keep_status") return ok(id, textResult(await keepStatus()));
      if (name === "keep_write") return ok(id, textResult(await withTabLock("Keep", name, () => keepWrite(args), debug)));
      if (name === "keep_notes") return ok(id, textResult(await withTabLock("Keep", name, () => keepNotes(args), debug)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handle(msg)).catch((e) => log("handler error:", String(e)));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready (CDP ${CDP})`);
