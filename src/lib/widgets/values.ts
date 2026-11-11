/**
 * What a widget's code says about values (client-safe): the names it publishes (zeff.publish), reads (zeff.values.get,
 * zeff.page.get, zeff.on), shares with the page (zeff.page.set) and sends the other widgets (zeff.emit). Found by reading the code
 * for calls with the name written out ("Monatsrate"); a name put together in the program isn't seen.
 */

export type WidgetValueScan = {
  /** zeff.publish("Name", …) — for the whole of Zeff. */
  publishes: string[];
  /** zeff.values.get("Name") — what other widgets published. */
  reads: string[];
  /** zeff.page.get("key") / zeff.page.set("key", …) — what the widgets on the page share. */
  pageGets: string[];
  pageSets: string[];
  /** zeff.emit("name", …) / zeff.on("name", …) — messages between the widgets of a page. */
  emits: string[];
  listens: string[];
};

const names = (code: string, path: string): string[] => {
  const re = new RegExp("zeff\\." + path + "\\s*\\(\\s*([\"'`])([^\"'`\\\\]{1,80})\\1", "g");
  return [...new Set([...code.matchAll(re)].map((m) => m[2].trim()).filter(Boolean))];
};

export function scanWidgetCode(code: string): WidgetValueScan {
  return {
    publishes: names(code, "publish"),
    reads: names(code, "values\\.get"),
    pageGets: names(code, "page\\.get"),
    pageSets: names(code, "page\\.set"),
    emits: names(code, "emit"),
    listens: names(code, "on").filter((n) => n !== "changed" && n !== "page" && n !== "value"),
  };
}
