/**
 * The WhatsApp adapter: everything that knows WhatsApp Web's insides — in one place, so an update of
 * WhatsApp Web is fixed here (or in contract.json) and nowhere else. The driver (driver.mjs) only
 * speaks MCP and shapes the results.
 *
 * What WhatsApp Web is expected to offer is the CONTRACT (contract.json, + the override file
 * data/automation/whatsapp.json): module names and the members they must have, CSS selectors with
 * alternatives, the words its interface shows. The functions below run IN the WhatsApp tab (they're
 * serialized, so they use nothing outside themselves); they find things through the probe
 * (scripts/automation/probe.mjs): by the module's known name, else by what it can do.
 *
 *   readState     what the tab shows: chats / link (QR) / elsewhere / loading
 *   readRows      the chat list's rows (the fallback: each chat's last message)
 *   readMessages  the messages of the active chats (WhatsApp's own collections; no chat opened)
 *   readHistory   one chat from its beginning
 *   selfCheck     the contract against the live tab + the shape of the live data (types only)
 *
 * No chat is opened by any of the readers: opening one sends blue ticks.
 */
import { loadContract, report, css } from "../../../scripts/automation/contract.mjs";
import { PROBE_SOURCE } from "../../../scripts/automation/probe.mjs";

export const contract = () => loadContract("whatsapp", new URL("./contract.json", import.meta.url));
export { css };

/** Runs `fn(arg)` in the tab with the probe installed (a navigation drops it, so it is put there each time). */
export async function inPage(page, fn, arg) {
  await page.evaluate(PROBE_SOURCE);
  return page.evaluate(fn, arg);
}

// ---------------------------------------------------------------------------
// When: the list's time column — "15:45", "3:45 PM", "Gestern", "Freitag", "09.10.2026", "10/9/26"
// ---------------------------------------------------------------------------

const WEEKDAYS = { sonntag: 0, sunday: 0, montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3, donnerstag: 4, thursday: 4, freitag: 5, friday: 5, samstag: 6, saturday: 6 };

export function parseWhen(text, now = new Date(), lang = "de") {
  const t = String(text || "").replace(/ | /g, " ").trim();
  const at = (d, h = 12, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
  let m = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(t);
  if (m) {
    let h = +m[1];
    if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    return at(now, h, +m[2]);
  }
  if (/^(heute|today)$/i.test(t)) return at(now);
  if (/^(gestern|yesterday)$/i.test(t)) return at(new Date(now.getTime() - 864e5));
  const wd = WEEKDAYS[t.toLowerCase()];
  if (wd !== undefined) {
    const back = (now.getDay() - wd + 7) % 7 || 7;
    return at(new Date(now.getTime() - back * 864e5));
  }
  m = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/.exec(t);
  if (m) {
    let [a, b, c] = [+m[1], +m[2], +m[3]];
    let y, mo, d;
    if (a > 999) [y, mo, d] = [a, b, c]; // 2026-10-09
    // 10/9/26 (US) or 09.10.2026 / 9/10/2026 (elsewhere): a number over 12 settles it, else the language.
    else if (b > 12 || (a <= 12 && t.includes("/") && /^en(-us)?$/i.test(lang))) [mo, d, y] = [a, b, c];
    else [d, mo, y] = [a, b, c];
    if (y < 100) y += 2000;
    // Not in the future: the other way round, then.
    if (new Date(y, mo - 1, d) > now && d <= 12) [mo, d] = [d, mo];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return at(new Date(y, mo - 1, d));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runs IN the WhatsApp tab
// ---------------------------------------------------------------------------

/** The chat rows rendered now (the list is virtual — only those near the view). */
export function readRows({ contract }) {
  const P = window.__zeffProbe;
  const S = contract.selectors;
  const pane = P.sel(S.chatList);
  if (!pane) return { ready: false, rows: [], lang: document.documentElement.lang || "" };
  const WHEN = /^(\d{1,2}:\d{2}(\s?[AP]M)?|heute|today|gestern|yesterday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,4}[./-]\d{1,2}[./-]\d{1,4})$/i;
  const UNREAD = P.re(contract.texts.unread);
  const rowCss = P.css(S.chatRows);
  const items = P.selAll(S.chatRows, pane).filter((r) => !r.parentElement?.closest(rowCss));
  const rows = items.map((r) => {
    const titles = P.selAll(S.rowTitle, r).map((s) => s.getAttribute("title")?.trim() || "").filter(Boolean);
    const lines = (r.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const name = titles[0] || lines[0] || "";
    const when = lines.find((l) => WHEN.test(l.replace(/ | /g, " "))) || "";
    const unreadLabel = [...r.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") || "").find((l) => UNREAD.test(l)) || "";
    const unreadCount = +(/(\d+)/.exec(unreadLabel)?.[1] || 0);
    // The last message: the list shows it in one line (a group's with "Anna: " before it); its tooltip has it in full.
    const line = lines.find((l) => l !== name && l !== when && !/^\d+$/.test(l) && !UNREAD.test(l)) || "";
    const full = titles.slice(1).sort((a, b) => b.length - a.length)[0] || "";
    const prefix = /^([^:\n]{1,40}):\s/.exec(line)?.[1] || "";
    const text = full && full.length >= line.length - prefix.length - 2 ? full : prefix ? line.slice(prefix.length + 1).trim() : line;
    // Yours: the ticks (sent, delivered, read) before it.
    const TICK = P.re(contract.texts.tick);
    const mine = P.selAll(S.rowTick, r).some((e) => TICK.test(e.getAttribute("data-icon") || e.textContent || ""));
    return { name, when, text, sender: prefix && !full.startsWith(`${prefix}:`) ? prefix : "", mine, unread: unreadCount > 0 || !!unreadLabel, unreadCount };
  });
  return { ready: true, rows, lang: document.documentElement.lang || "", scrollTop: pane.scrollTop, scrollMax: pane.scrollHeight - pane.clientHeight };
}

/** What WhatsApp Web shows instead of the chats — the QR code (not linked), "open in another window", loading. */
export function readState({ contract }) {
  const P = window.__zeffProbe;
  const text = (document.body?.innerText || "").slice(0, 4000);
  if (P.sel(contract.selectors.chatList)) return "chats";
  if (P.sel(contract.selectors.qr) || P.re(contract.texts.qr).test(text)) return "link";
  if (P.re(contract.texts.elsewhere).test(text)) return "elsewhere";
  return "loading";
}

/** The open chat's name(s) in its header. */
export function readHeader({ contract }) {
  const P = window.__zeffProbe;
  return P.selAll(contract.selectors.chatHeader)
    .map((e) => e.getAttribute("title") || e.textContent || "")
    .join(" | ");
}

/** Whether the open chat's last outgoing message contains `start`. */
export function sentSeen({ contract, start }) {
  const outs = window.__zeffProbe.selAll(contract.selectors.outgoing);
  return !!outs.length && (outs[outs.length - 1].textContent || "").includes(start);
}

/** The open chat's message list — the scrolling part of the main pane (the tallest). To its top; its height. */
export function scrollChatTop({ contract }) {
  const P = window.__zeffProbe;
  const main = P.sel(contract.selectors.main);
  if (!main) return null;
  const els = [...main.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY));
  const el = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!el) return null;
  el.scrollTop = 0;
  return el.scrollHeight;
}

/**
 * The messages of the chats active since `since` (seconds) — from what WhatsApp Web has decrypted for
 * display (its own collections), earlier ones loaded from its local store as needed (loadEarlierMsgs —
 * what scrolling up in a chat would load). No chat is opened or marked seen: read receipts go only
 * when you open a chat.
 */
export async function readMessages({ contract, since, maxLoads, maxMessages }) {
  const P = window.__zeffProbe;
  const C = P.module(contract.modules.collections)?.mod;
  const load = P.module(contract.modules.load)?.mod;
  if (!C?.Chat?.getModelsArray || !load) return { error: "no-internals", missing: [!C && "collections", !load && "load"].filter(Boolean) };
  const MEDIA = { image: "Bild", video: "Video", ptt: "Sprachnachricht", audio: "Audio", document: "Dokument", location: "Standort", vcard: "Kontakt", multi_vcard: "Kontakte", poll_creation: "Umfrage", album: "Album" };
  // A message's own id: _serialized where there is one, else String(id) (WhatsApp Web's id objects stopped having _serialized: it prints as "false_<chat>_<hash>"), else "<chat>|<time>" — what a message kept before is matched by (saveMails: same chat, time and words keep their row).
  const idOf = (chat, m) => (typeof m.id?._serialized === "string" ? m.id._serialized : /^(true|false)_/.test(String(m.id ?? "")) ? String(m.id) : `${chat.id?._serialized}|${m.t}`);
  const nameOf = (c) => c?.formattedName || c?.name || c?.pushname || c?.verifiedName || c?.id?.user || "";
  const lastAt = (c) => Math.max(c.t || 0, ...(c.msgs?.getModelsArray?.() ?? []).map((m) => m.t || 0));
  // You (your number and your lid): a group message mentioning you or quoting yours is to you.
  const Me = P.module(contract.modules.me)?.mod ?? null;
  const isMe = (w) => {
    try {
      return !!w && !!Me?.isMeAccount?.(w);
    } catch {
      return false;
    }
  };
  // WhatsApp's own account (0@c.us: its tips and offers) isn't a conversation.
  const chats = C.Chat.getModelsArray().filter((c) => lastAt(c) >= since && !c.archive && !/@(newsletter|broadcast)$/.test(c.id?._serialized ?? "") && c.id?.user !== "status" && c.id?.user !== "0");
  const out = [];
  const seen = new Set();
  for (const chat of chats) {
    const msgs = () => chat.msgs?.getModelsArray?.() ?? [];
    // Nothing loaded of it yet: its latest messages first (what the list's preview comes from).
    if (!msgs().length && load.loadRecentMsgs) {
      try {
        await load.loadRecentMsgs({ chat, msgs: chat.msgs });
      } catch {
        // as it is
      }
    }
    // Earlier ones, from WhatsApp's own store, until the window is covered (a few times at most).
    for (let i = 0; i < maxLoads && msgs().length && msgs()[0].t >= since; i++) {
      const before = msgs().length;
      try {
        // ({ chat, msgs }): the shape it takes now — the chat alone, as it took it before.
        await load.loadEarlierMsgs({ chat, msgs: chat.msgs }).catch(() => load.loadEarlierMsgs(chat));
      } catch {
        break;
      }
      if (msgs().length === before) break;
    }
    const title = chat.formattedTitle || chat.name || nameOf(chat.contact) || chat.id?.user || "?";
    const group = !!chat.isGroup || /@g\.us$/.test(chat.id?._serialized ?? "");
    for (const m of msgs()) {
      const id = idOf(chat, m);
      if (m.t < since || m.isNotification || m.revokeTimestamp || seen.has(id)) continue;
      seen.add(id);
      const media = MEDIA[m.type];
      const text = m.type === "chat" ? m.body : media ? `[${media}]${m.caption ? ` ${m.caption}` : m.type === "poll_creation" && m.pollName ? ` ${m.pollName}` : ""}` : "";
      if (!text?.trim()) continue;
      const fromMe = !!m.id?.fromMe;
      out.push({
        id,
        chat: title,
        from: fromMe ? "Ich" : group ? nameOf(m.senderObj) || m.notifyName || "?" : title,
        t: m.t,
        text: text.slice(0, 2000),
        unread: !fromMe && chat.unreadCount > 0 && msgs().indexOf(m) >= msgs().length - chat.unreadCount,
        group,
        toMe: group && !fromMe && ((m.mentionedJidList || []).some(isMe) || isMe(m.quotedParticipant)),
      });
    }
  }
  out.sort((a, b) => b.t - a.t);
  return { messages: out.slice(0, maxMessages), chats: chats.length };
}

/**
 * One chat's messages from its very beginning — found by its name (exactly, else regardless of case,
 * else the one name containing it), its earlier messages loaded again and again (what scrolling up
 * to the top would load: WhatsApp's local store, then on demand from your phone) until no more come.
 * The chat isn't opened: no read receipts.
 */
export async function readHistory({ contract, name, maxLoads, settleMs }) {
  const P = window.__zeffProbe;
  const C = P.module(contract.modules.collections)?.mod;
  const load = P.module(contract.modules.load)?.mod;
  if (!C?.Chat?.getModelsArray || !load) return { error: "no-internals", missing: [!C && "collections", !load && "load"].filter(Boolean) };
  const MEDIA = { image: "Bild", video: "Video", ptt: "Sprachnachricht", audio: "Audio", document: "Dokument", location: "Standort", vcard: "Kontakt", multi_vcard: "Kontakte", poll_creation: "Umfrage", album: "Album", sticker: "Sticker" };
  // A message's own id: _serialized where there is one, else String(id) (WhatsApp Web's id objects stopped having _serialized: it prints as "false_<chat>_<hash>"), else "<chat>|<time>" — what a message kept before is matched by (saveMails: same chat, time and words keep their row).
  const idOf = (chat, m) => (typeof m.id?._serialized === "string" ? m.id._serialized : /^(true|false)_/.test(String(m.id ?? "")) ? String(m.id) : `${chat.id?._serialized}|${m.t}`);
  const nameOf = (c) => c?.formattedName || c?.name || c?.pushname || c?.verifiedName || c?.id?.user || "";
  const titleOf = (c) => c.formattedTitle || c.name || nameOf(c.contact) || c.id?.user || "";
  const all = C.Chat.getModelsArray().filter((c) => !/@(newsletter|broadcast)$/.test(c.id?._serialized ?? "") && c.id?.user !== "status");
  const want = String(name).trim();
  let found = all.filter((c) => titleOf(c) === want);
  if (!found.length) found = all.filter((c) => titleOf(c).toLowerCase() === want.toLowerCase());
  if (!found.length) found = all.filter((c) => titleOf(c).toLowerCase().includes(want.toLowerCase()));
  if (found.length !== 1) return { error: found.length ? "ambiguous" : "not-found", candidates: found.slice(0, 12).map(titleOf) };
  const chat = found[0];
  const msgs = () => chat.msgs?.getModelsArray?.() ?? [];
  if (!msgs().length && load.loadRecentMsgs) {
    try {
      await load.loadRecentMsgs({ chat, msgs: chat.msgs });
    } catch {
      // as it is
    }
  }
  let loads = 0;
  let stale = 0;
  const done = () => !!chat.msgs?.msgLoadState?.noEarlierMsgs;
  while (loads < maxLoads && !done()) {
    const before = msgs().length;
    try {
      await load.loadEarlierMsgs({ chat, msgs: chat.msgs }).catch(() => load.loadEarlierMsgs(chat));
    } catch {
      break;
    }
    loads++;
    if (msgs().length > before) {
      stale = 0;
      continue;
    }
    // Nothing new: the phone may still be sending older ones — wait a little, a few times.
    if (++stale >= 4) break;
    await new Promise((r) => setTimeout(r, settleMs));
  }
  const title = titleOf(chat);
  const group = !!chat.isGroup || /@g\.us$/.test(chat.id?._serialized ?? "");
  const out = [];
  const seen = new Set();
  for (const m of msgs()) {
    const id = idOf(chat, m);
    if (m.isNotification || m.revokeTimestamp || seen.has(id)) continue;
    seen.add(id);
    const media = MEDIA[m.type];
    const text = m.type === "chat" ? m.body : media ? `[${media}]${m.caption ? ` ${m.caption}` : m.type === "poll_creation" && m.pollName ? ` ${m.pollName}` : ""}` : "";
    if (!text?.trim()) continue;
    const fromMe = !!m.id?.fromMe;
    out.push({ id, chat: title, from: fromMe ? "Ich" : group ? nameOf(m.senderObj) || m.notifyName || "?" : title, t: m.t, text: text.slice(0, 4000) });
  }
  out.sort((a, b) => a.t - b.t);
  return { chat: title, messages: out, loads, complete: done(), total: msgs().length };
}

/**
 * The contract against the live tab, read-only: every module, selector and word the driver relies on
 * (the probe), plus the SHAPE of the live data the readers use — which fields a chat and a message
 * have, as types and counts only (never a name or a text).
 */
export function selfCheck({ contract }) {
  const P = window.__zeffProbe;
  const checks = P.check(contract);
  const add = (id, ok, detail) => checks.push({ kind: "data", id, level: ok ? "ok" : "fail", ...(detail ? { detail } : {}) });
  const C = P.module(contract.modules.collections)?.mod;
  if (!C?.Chat?.getModelsArray) return checks;
  const chats = C.Chat.getModelsArray();
  add("chats", chats.length > 0, `${chats.length} chats`);
  const chat = chats.find((c) => c.msgs?.getModelsArray?.().length) || chats[0];
  if (chat) {
    const need = ["id._serialized:string", "msgs.getModelsArray:function", "unreadCount:number"];
    const lacks = need.filter((h) => !P.shape(chat, [h]));
    add("chat-fields", !lacks.length, lacks.length ? `lacks ${lacks.join(", ")}` : need.join(", "));
    // (isGroup has a fallback: the id's @g.us)
    const optional = ["t:number", "archive", "formattedTitle:string"].filter((h) => !P.shape(chat, [h]));
    if (optional.length) checks.push({ kind: "data", id: "chat-fields-optional", level: "warn", detail: `lacks ${optional.join(", ")}` });
  }
  const msg = chats.flatMap((c) => c.msgs?.getModelsArray?.().slice(-1) ?? [])[0];
  if (msg) {
    const need = ["id.fromMe:boolean", "t:number", "type:string"];
    const lacks = need.filter((h) => !P.shape(msg, [h]));
    add("message-fields", !lacks.length, lacks.length ? `lacks ${lacks.join(", ")}` : need.join(", "));
    // A message's own id (what its row is kept by): _serialized, else what String(id) prints; neither: "<chat>|<time>" (two messages in the same second of one chat then count as one).
    const printed = /^(true|false)_/.test(String(msg.id ?? ""));
    if (!P.shape(msg, ["id._serialized:string"])) checks.push({ kind: "data", id: "message-id", level: printed ? "ok" : "warn", detail: printed ? "id._serialized is gone — String(id) is the id" : "no id to read (_serialized, String(id)) — messages are keyed chat|time" });
  } else checks.push({ kind: "data", id: "message-fields", level: "skip", detail: "no message loaded to look at" });
  return checks;
}

/** The self-check as a report (Node side). */
export async function runSelfCheck(page) {
  const c = contract();
  const checks = await inPage(page, selfCheck, { contract: c });
  return report("whatsapp", checks, c);
}
