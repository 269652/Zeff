"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// Widgets: what plugins show on a page
// ---------------------------------------------------------------------------

/** The widgets the installed plugins bring (to pick one for a block). */
export async function widgetCatalogAction() {
  return run(async () => ({ widgets: (await import("../widgets")).widgetCatalog() }));
}

/** A widget's data now (kept a moment). */
export async function widgetDataAction(id: string, config: Record<string, unknown>) {
  return run(async () => ({ data: await (await import("../widgets")).widgetData(String(id), config && typeof config === "object" ? config : {}) }));
}

/** A button of a widget pressed — the data after it. */
export async function widgetActAction(id: string, action: string, payload: Record<string, string>, config: Record<string, unknown>) {
  return run(async () => ({ data: await (await import("../widgets")).widgetAct(String(id), String(action), payload && typeof payload === "object" ? payload : {}, config && typeof config === "object" ? config : {}) }));
}
