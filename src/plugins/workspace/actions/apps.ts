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
    const w = wantsOf(allow?.dbs ?? [], allow?.ai);
    return { grant: grantWidget(String(key), { dbs: w.writes, ...(w.ai ? { ai: true } : {}) }, title) };
  });
}

/** You take back what a widget was allowed (a database, the AI, or all). */
export async function revokeWidgetAction(key: string, what?: { db?: number; ai?: boolean }) {
  return run(async () => {
    const { revokeWidget } = await import("../widget-bridge");
    return { grant: revokeWidget(String(key), what) };
  });
}

/** A widget (the assistant's, shown in its answer) put into a page as a block, at its end. */
export async function addWidgetBlockAction(pageId: number, w: { title: string; html: string; libs: string[]; writes: number[]; ai: boolean }) {
  return run(async () => {
    const store = await import("../store");
    const { widgetProblem } = await import("../widget-make");
    const p = store.getPage(Number(pageId));
    if (!p || p.kind === "database") throw new Error("No page to put it into.");
    if (p.locked) throw new Error("That page is locked.");
    const problem = widgetProblem({ html: String(w?.html ?? "") });
    if (problem) throw new Error(problem);
    const wants = wantsOf(w.writes, w.ai);
    const keep = p.content.content.filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
    const node = { type: "zeffApp", attrs: { title: String(w.title ?? "").slice(0, 80), prompt: "", html: w.html, libs: (w.libs ?? []).join(","), writes: wants.writes.join(","), ai: !!wants.ai, state: "" } };
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
    const { makeWidget } = await import("../widget-make");
    const { grantWidget, widgetContext, widgetGrant } = await import("../widget-bridge");
    const made = await makeWidget(String(request ?? ""), { pageId: pageId ? Number(pageId) : null, ...(current?.html ? { current } : {}) });
    // What it may write to: the databases on this page it asks for, and what you allowed the widget it was before.
    const onPage = new Set(widgetContext(pageId).databases.filter((d) => "onPage" in d).map((d) => d.id));
    const before = current?.html ? widgetGrant(widgetKey(current.html)) : null;
    const here = made.wants.writes.filter((id) => onPage.has(id) || before?.dbs.includes(id));
    const ai = !!(made.wants.ai && before?.ai);
    const key = widgetKey(made.html);
    const grant = here.length || ai ? grantWidget(key, { dbs: here, ...(ai ? { ai: true } : {}) }, made.title) : null;
    return { widget: made, key, grant };
  });
}
