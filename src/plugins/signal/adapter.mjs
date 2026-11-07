/**
 * The Signal adapter: everything that knows Signal Desktop's insides — in one place, so an update of
 * Signal is fixed here (or in contract.json) and nowhere else. The driver (driver.mjs) starts Signal,
 * speaks MCP and shapes the results.
 *
 * What Signal Desktop is expected to offer is the CONTRACT (contract.json, + the override file
 * data/automation/signal.json): the globals of its app (ConversationController, reduxStore, …) and
 * the members they need, the redux state's layout, the paths that moved between versions (which
 * chat is open), the words/patterns of its windows. The functions below run IN Signal's isolated
 * world (they're serialized, so they use nothing outside themselves) and find things through the
 * probe (scripts/automation/probe.mjs).
 *
 * Signal's app runs in its window's isolated (preload) world; reading puts the messages into Signal's
 * in-memory store only: no chat opened, nothing marked read, no read receipt sent. Signal's database
 * (SQLCipher) isn't touched — its key isn't extracted.
 */
import { loadContract, report } from "../../../scripts/automation/contract.mjs";
import { PROBE_SOURCE } from "../../../scripts/automation/probe.mjs";

export const contract = () => loadContract("signal", new URL("./contract.json", import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CDP: Signal's window, its isolated world
// ---------------------------------------------------------------------------

/**
 * Signal's main window over CDP (the port is up): `run(fn, arg)` evaluates fn({ contract, ...arg })
 * in its isolated world with the probe installed; `cdp` sends raw commands.
 */
export async function attach(endpoint, C = contract()) {
  const list = await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  // The window by the first pattern that finds one (the app's own page first, then any page of Signal).
  let target;
  for (const pattern of C.texts.windowUrl) target ??= list.find((t) => t.type === "page" && new RegExp(pattern, "i").test(t.url));
  if (!target?.webSocketDebuggerUrl) throw new Error("Signal Desktop's window isn't there (still starting?).");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("Signal Desktop's debug port didn't accept the connection."));
  });
  let id = 0;
  const pending = new Map();
  const contexts = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
    else if (m.method === "Runtime.executionContextDestroyed") {
      const i = contexts.findIndex((c) => c.id === m.params.executionContextId);
      if (i >= 0) contexts.splice(i, 1);
    }
  };
  ws.onclose = () => {
    for (const r of pending.values()) r({ error: { message: "Signal Desktop closed the connection." } });
    pending.clear();
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await cdp("Runtime.enable");
  const isolated = async () => {
    const name = new RegExp(C.texts.contextName.join("|"), "i");
    for (let i = 0; i < 60; i++) {
      const c = contexts.find((x) => x.auxData?.type === "isolated" && name.test(x.name)) || contexts.find((x) => x.auxData?.type === "isolated");
      if (c) return c.id;
      await sleep(250);
    }
    throw new Error("Signal Desktop's app context isn't there (still starting?).");
  };
  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, contextId: await isolated(), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Signal: ${r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const run = async (fn, arg) => {
    await evaluate(PROBE_SOURCE);
    return evaluate(`(${fn.toString()})(${JSON.stringify({ contract: C, ...(arg ?? {}) })})`);
  };
  return { run, cdp, contract: C, close: () => ws.close() };
}

// ---------------------------------------------------------------------------
// Runs IN Signal (its isolated world)
// ---------------------------------------------------------------------------

/** Signal's state — loaded (the inbox), linked (an account), still starting. */
export function readState({ contract }) {
  const P = window.__zeffProbe;
  const CC = P.global(contract.globals.conversations)?.value;
  const s = P.global(contract.globals.store)?.value?.getState?.();
  if (!s || !CC) return "loading";
  const view = String(s.app?.appView ?? "");
  if (P.re(contract.texts.linkViews).test(view)) return "link";
  if (!P.re(contract.texts.inboxView).test(view) || !s.app?.hasInitialLoadCompleted) return "loading";
  return CC.getOurConversationId?.() ? "chats" : "link";
}

/**
 * The messages of the chats active since `since` (ms) — each chat's newest messages loaded into
 * Signal's memory if they aren't yet, earlier ones as needed (what scrolling up would load). The chat
 * you have open isn't touched (its view would jump): what it shows is read as is. No chat opened,
 * nothing marked read. With `chat`: that one chat, from its beginning as far as Signal has it.
 */
export async function readMessages({ contract, since, maxLoads, maxMessages, chat = null }) {
  const P = window.__zeffProbe;
  const CC = P.global(contract.globals.conversations).value;
  const redux = P.global(contract.globals.store).value;
  const state = () => redux.getState();
  const store = () => P.pick(state(), contract.paths.messageList);
  const lookup = () => P.pick(state(), contract.paths.messageLookup);
  const ourId = CC.getOurConversationId();
  const ourAci = CC.get(ourId)?.get("serviceId");
  // The chat open in Signal (Signal 8: in its navigation state; older: in conversations).
  const selected = P.pick(state(), contract.paths.selectedConversation);
  const titleOf = (c) => c?.getTitle?.() || c?.get?.("name") || c?.get?.("profileName") || "?";
  const lastAt = (c) => Math.max(c.get("active_at") || 0, c.get("timestamp") || 0);
  let convs;
  if (chat) {
    const all = CC.getAll().filter((c) => c.id !== ourId && ["private", "group"].includes(c.get("type")));
    const want = String(chat).trim();
    let found = all.filter((c) => titleOf(c) === want);
    if (!found.length) found = all.filter((c) => titleOf(c).toLowerCase() === want.toLowerCase());
    if (!found.length) found = all.filter((c) => titleOf(c).toLowerCase().includes(want.toLowerCase()));
    if (found.length !== 1) return { error: found.length ? "ambiguous" : "not-found", candidates: found.slice(0, 12).map(titleOf) };
    convs = found;
  } else {
    // (Your own chat — "Notiz an mich" / "Note to Self" — is read too: it is your notebook; its lines are tasks and reminders for you.)
    convs = CC.getAll().filter((c) => ["private", "group"].includes(c.get("type")) && !c.get("isArchived") && !c.isBlocked?.() && lastAt(c) >= since);
  }
  const ids = (c) => store()[c.id]?.messageIds ?? [];
  const msgOf = (id) => lookup()[id];
  const MEDIA = (a) => {
    const t = String(a?.contentType || "");
    if (a?.flags & 1 || /audio\/(aac|ogg)/.test(t)) return "Sprachnachricht";
    if (t.startsWith("image/gif")) return "GIF";
    if (t.startsWith("image/")) return "Bild";
    if (t.startsWith("video/")) return "Video";
    if (t.startsWith("audio/")) return "Audio";
    return "Dokument";
  };
  const out = [];
  const seen = new Set();
  let loaded = 0;
  // A chat with unread messages loads around the first unread one — without waiting for it: until
  // its messages are there (Signal says it's done loading).
  const settled = async (c) => {
    for (let i = 0; i < 50; i++) {
      const s = store()[c.id];
      if (s?.messageIds?.length && !s.messageLoadingState) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  for (const c of convs) {
    if (c.id !== selected) {
      if (!ids(c).length) {
        try {
          await c.loadNewestMessages(undefined, undefined);
          await settled(c);
          loaded++;
        } catch {
          // as it is
        }
      }
      // Earlier ones until the window is covered (a chat's whole history: until no more come).
      for (let i = 0; i < maxLoads && ids(c).length; i++) {
        const oldest = msgOf(ids(c)[0]);
        if (!oldest || (oldest.sent_at || 0) < since) break;
        const before = ids(c).length;
        try {
          await c.loadOlderMessages(oldest.id);
        } catch {
          break;
        }
        if (ids(c).length === before) break;
      }
    }
    // Your own chat is called "Notiz an mich" here whatever Signal titles it (your own name, "Note to Self"): the review knows it by that name.
    const title = c.id === ourId ? "Notiz an mich" : titleOf(c);
    const group = c.get("type") === "group";
    const unreadCount = c.get("unreadCount") || 0;
    const list = ids(c).map(msgOf).filter(Boolean);
    list.forEach((m, i) => {
      if (m.type !== "incoming" && m.type !== "outgoing") return;
      if ((m.sent_at || 0) < since || m.isErased || m.deletedForEveryone || m.storyId || seen.has(m.id)) return;
      seen.add(m.id);
      const media = m.sticker ? "Sticker" : m.attachments?.length ? MEDIA(m.attachments[0]) : m.poll ? "Umfrage" : null;
      const body = (m.body || "").trim();
      const text = media ? `[${media}]${body ? ` ${body}` : m.poll?.question ? ` ${m.poll.question}` : ""}` : body;
      if (!text) return;
      const fromMe = m.type === "outgoing";
      const sender = fromMe ? null : CC.get(m.sourceServiceId) || CC.get(m.source);
      out.push({
        id: m.id,
        chat: title,
        from: fromMe ? "Ich" : group ? titleOf(sender) : title,
        t: m.sent_at,
        text: text.slice(0, 4000),
        unread: !fromMe && (m.readStatus === 1 || (unreadCount > 0 && i >= list.length - unreadCount)),
        group,
        toMe: group && !fromMe && (!!m.mentionsMe || (!!ourAci && m.quote?.authorAci === ourAci)),
      });
    });
  }
  out.sort((a, b) => b.t - a.t);
  // One chat: from its beginning when its oldest message (Signal's metrics) is loaded.
  const oldest = chat ? store()[convs[0].id]?.metrics?.oldest : null;
  const complete = chat ? !!oldest && ids(convs[0])[0] === oldest.id : undefined;
  return { messages: out.slice(0, maxMessages), chats: convs.length, loaded, chat: chat ? titleOf(convs[0]) : undefined, complete };
}

/** Each active chat's last message, from what its chat list shows. */
export function readChats({ contract, since }) {
  const CC = window.__zeffProbe.global(contract.globals.conversations).value;
  const ourId = CC.getOurConversationId();
  return CC.getAll()
    .filter((c) => ["private", "group"].includes(c.get("type")) && !c.get("isArchived") && !c.isBlocked?.() && (c.get("timestamp") || c.get("active_at") || 0) >= since && c.get("lastMessage"))
    .map((c) => ({
      chat: c.id === ourId ? "Notiz an mich" : c.getTitle(),
      group: c.get("type") === "group",
      at: c.get("timestamp") || c.get("active_at"),
      text: String(c.get("lastMessage") || "").slice(0, 2000),
      // Only your own messages have a status (sent, delivered, read).
      mine: c.get("lastMessageStatus") != null,
      sender: c.get("lastMessageAuthor") || "",
      unread: (c.get("unreadCount") || 0) > 0,
    }));
}

/** The chat with exactly this name (else why not) — opened when `open`. "Notiz an mich" / "Note to Self": yours. */
export function findChat({ contract, name, open }) {
  const P = window.__zeffProbe;
  const CC = P.global(contract.globals.conversations).value;
  const ourId = CC.getOurConversationId();
  const found = P.re(contract.texts.noteToSelf).test(name) ? [CC.get(ourId)].filter(Boolean) : CC.getAll().filter((c) => c.id !== ourId && ["private", "group"].includes(c.get("type")) && c.getTitle() === name);
  if (found.length !== 1) return { error: found.length ? "ambiguous" : "not-found" };
  const c = found[0];
  if (c.isBlocked?.()) return { error: "blocked" };
  if (open) P.global(contract.globals.actions).value.conversations.showConversation({ conversationId: c.id });
  return { id: c.id, title: c.id === ourId ? name : c.getTitle() };
}

/** The open chat's composer focused — if it's that chat. */
export function focusComposer({ contract, id }) {
  const P = window.__zeffProbe;
  const st = P.global(contract.globals.store).value.getState();
  if (P.pick(st, contract.paths.selectedConversation) !== id) return "other";
  const el = P.sel(contract.selectors.composer);
  if (!el) return "none";
  el.focus();
  return document.activeElement === el ? "ok" : "unfocused";
}

/** The composer's text now. */
export function composerText({ contract }) {
  const P = window.__zeffProbe;
  return P.sel(contract.selectors.composer)?.innerText?.trim() ?? null;
}

/** Whether that chat's newest outgoing message since `at` starts with `start`. */
export function sentSince({ contract, id, at, start }) {
  const P = window.__zeffProbe;
  const st = P.global(contract.globals.store).value.getState();
  const ids = P.pick(st, contract.paths.messageList)[id]?.messageIds ?? [];
  const lookup = P.pick(st, contract.paths.messageLookup);
  return ids.map((i) => lookup[i]).some((m) => m?.type === "outgoing" && (m.sent_at || 0) >= at && String(m.body || "").startsWith(start));
}

/**
 * The contract against the live app, read-only: the globals and state the driver relies on (the
 * probe), plus the SHAPE of the live data — the methods of a chat, the types of its attributes and of
 * a loaded message — as types and counts only (never a name or a text).
 */
export function selfCheck({ contract }) {
  const P = window.__zeffProbe;
  const checks = P.check(contract);
  const add = (id, ok, detail) => checks.push({ kind: "data", id, level: ok ? "ok" : "fail", ...(detail ? { detail } : {}) });
  const CC = P.global(contract.globals.conversations)?.value;
  if (!CC) return checks;
  const convs = CC.getAll().filter((c) => ["private", "group"].includes(c.get?.("type")));
  add("chats", convs.length > 0, `${convs.length} chats`);
  const c = convs[0];
  if (c) {
    const methods = ["loadNewestMessages:function", "loadOlderMessages:function", "getTitle:function", "get:function", "isBlocked:function"];
    const lacks = methods.filter((h) => !P.shape(c, [h]));
    add("chat-methods", !lacks.length, lacks.length ? `lacks ${lacks.join(", ")}` : methods.map((m) => m.split(":")[0]).join(", "));
    const attrs = { type: "string", unreadCount: "number", isArchived: "boolean", timestamp: "number", lastMessage: "string", serviceId: "string" };
    // Attributes that are only set sometimes: looked for over all chats.
    const notSeen = Object.entries(attrs).filter(([k, t]) => !convs.some((x) => typeof x.get(k) === t));
    checks.push({ kind: "data", id: "chat-attributes", level: notSeen.length ? "warn" : "ok", detail: notSeen.length ? `no chat has ${notSeen.map(([k, t]) => `${k}:${t}`).join(", ")}` : Object.keys(attrs).join(", ") });
  }
  const st = P.global(contract.globals.store)?.value?.getState?.();
  const lookup = st && P.pick(st, contract.paths.messageLookup);
  const msg = lookup && Object.values(lookup)[0];
  if (msg) {
    const need = ["type:string", "sent_at:number", "id:string"];
    const lacks = need.filter((h) => !P.shape(msg, [h]));
    add("message-fields", !lacks.length, lacks.length ? `lacks ${lacks.join(", ")}` : need.join(", "));
  } else checks.push({ kind: "data", id: "message-fields", level: "skip", detail: "no message loaded to look at" });
  return checks;
}

/** The self-check as a report (Node side). */
export async function runSelfCheck(session) {
  return report("signal", await session.run(selfCheck), session.contract);
}
