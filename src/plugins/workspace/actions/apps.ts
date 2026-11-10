"use server";

import { isCallName, wantsOf, widgetKey, type WidgetGrant } from "@/lib/widgets/bridge";
import { run } from "./shared";

// ---------------------------------------------------------------------------
// Widgets an AI wrote (lib/widgets): their calls, what the user allowed them, and making one
// ---------------------------------------------------------------------------

/** A widget's call to Zeff (widget-bridge.ts) — its answer, or why not (a refusal the widget shows). */
export async function widgetCallAction(key: string, method: string, args: Record<string, unknown>) {
  return run(async () => {
    if (!isCallName(method)) throw new Error(`Unknown call "${String(method)}".`);
    const { widgetCall } = await import("../widget-bridge");
    return { value: await widgetCall(String(key), method, args && typeof args === "object" && !Array.isArray(args) ? args : {}) };
  });
}

/** What a widget (by its key) is allowed, and what it is told of where it is. */
export async function widgetGrantAction(key: string, pageId?: number | null) {
  return run(async () => {
    const { widgetGrant, widgetContext } = await import("../widget-bridge");
    return { grant: widgetGrant(String(key)), context: widgetContext(pageId ? Number(pageId) : null) };
  });
}

/** What a widget on this page is told of where it is (its databases — the page's first). */
export async function widgetContextAction(pageId?: number | null) {
  return run(async () => ({ context: (await import("../widget-bridge")).widgetContext(pageId ? Number(pageId) : null) }));
}

/** You allow a widget what it asked: to write to these databases, to ask the AI. */
export async function allowWidgetAction(key: string, allow: WidgetGrant, title?: string) {
  return run(async () => {
    const { grantWidget } = await import("../widget-bridge");
    const w = wantsOf(allow?.dbs ?? [], allow?.ai, allow?.flows);
    return { grant: grantWidget(String(key), { dbs: w.writes, ...(w.ai ? { ai: true } : {}), ...(w.flows ? { flows: w.flows } : {}) }, title) };
  });
}

/**
 * A widget publishes a value for the whole of Zeff (zeff.publish). Its owner: the block (`wid`) — or, outside a page, the widget's
 * code (its key); a name another widget published is refused.
 */
export async function publishWidgetValueAction(key: string, wid: string | null, pageId: number | null, title: string, v: { name: string; value: unknown; unit?: string; label?: string }) {
  return run(async () => {
    const { publishOutput } = await import("../widget-outputs");
    const owner = wid && /^[a-z0-9]{8,24}$/.test(wid) ? `b:${wid}` : /^w[0-9a-f]{14}$/.test(String(key)) ? `k:${key}` : "";
    const o = publishOutput(String(v?.name ?? ""), v?.value ?? null, { owner, pageId: pageId ? Number(pageId) : null, widget: String(title ?? ""), unit: v?.unit ? String(v.unit) : undefined, label: v?.label ? String(v.label) : undefined });
    return { name: o?.key ?? null };
  });
}

/** The values widgets published, with their values — for the views (outputs.<name>). */
export async function widgetOutputsAction() {
  return run(async () => ({ outputs: (await import("../widget-outputs")).outputsByKey() }));
}

/** A widget block's versions (newest first, without their code). */
export async function widgetVersionsAction(wid: string) {
  return run(async () => ({ versions: (await import("../widget-versions")).listVersions(String(wid)) }));
}

/** One version of a widget block, with its code. */
export async function widgetVersionAction(wid: string, n: number) {
  return run(async () => {
    const v = (await import("../widget-versions")).getVersion(String(wid), Number(n));
    if (!v) throw new Error("That version is gone.");
    return { version: v };
  });
}

/**
 * A widget block's change kept as a version — its code edited by hand, an older version brought back, or the first one (a block
 * from before versions). What it was allowed carries over to the code brought back (it is the same code, the same key).
 */
export async function saveWidgetVersionAction(wid: string, pageId: number | null, v: { source: "code" | "restore" | "first"; prompt?: string; title?: string; html: string; libs?: string[]; writes?: number[]; ai?: boolean; flows?: string[] }) {
  return run(async () => {
    const { checkWidgetHtml } = await import("@/lib/widgets/sandbox");
    const c = checkWidgetHtml(String(v?.html ?? ""));
    if (!c.ok) throw new Error(c.why);
    const src = v.source === "restore" || v.source === "first" ? v.source : "code";
    return { version: (await import("../widget-versions")).addVersion(String(wid), { ...v, source: src, pageId: pageId ? Number(pageId) : null }).n };
  });
}

/** What the widgets on a page share (zeff.page.get): one value, or all of them. */
export async function widgetPageStateAction(pageId: number, key?: string) {
  return run(async () => ({ value: (await import("../widget-bridge")).pageState(Number(pageId), key === undefined || key === null ? undefined : String(key)) }));
}

/** A value the widgets on a page share, kept (zeff.page.set; null removes it). */
export async function setWidgetPageStateAction(pageId: number, key: string, value: unknown) {
  return run(async () => {
    (await import("../widget-bridge")).setPageState(Number(pageId), String(key), value);
    return {};
  });
}

/** You take back what a widget was allowed (a database, the AI, a flow, or all). */
export async function revokeWidgetAction(key: string, what?: { db?: number; ai?: boolean; flow?: string }) {
  return run(async () => {
    const { revokeWidget } = await import("../widget-bridge");
    return { grant: revokeWidget(String(key), what) };
  });
}

/** A widget (the assistant's, shown in its answer) put into a page as a block, at its end. */
export async function addWidgetBlockAction(pageId: number, w: { title: string; html: string; libs: string[]; writes: number[]; ai: boolean; flows?: string[] }) {
  return run(async () => {
    const store = await import("../store");
    const { widgetProblem } = await import("../widget-make");
    const p = store.getPage(Number(pageId));
    if (!p || p.kind === "database") throw new Error("No page to put it into.");
    if (p.locked) throw new Error("That page is locked.");
    const problem = widgetProblem({ html: String(w?.html ?? "") });
    if (problem) throw new Error(problem);
    const wants = wantsOf(w.writes, w.ai, w.flows);
    const keep = p.content.content.filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
    const node = { type: "zeffApp", attrs: { title: String(w.title ?? "").slice(0, 80), prompt: "", html: w.html, libs: (w.libs ?? []).join(","), writes: wants.writes.join(","), ai: !!wants.ai, flows: (wants.flows ?? []).join(","), state: "" } };
    store.updatePage(p.id, { content: { type: "doc", content: [...keep, node] } });
    return { pageId: p.id };
  });
}

/**
 * The AI makes a widget for a page's block (or changes it): what you asked for, with the page's databases around it. What
 * it writes to on this page is allowed at once (you asked for it here); anything else waits for your OK on the widget.
 */
export async function makeWidgetAction(request: string, pageId: number | null, current?: { title?: string; html: string; libs?: string[]; writes?: number[]; ai?: boolean }) {
  return run(async () => {
    const { buildWidget } = await import("../widget-make");
    return buildWidget(String(request ?? ""), pageId ? Number(pageId) : null, current);
  });
}
