/**
 * POST a JSON body to a route and read the JSON answer (a route, because server actions queue behind each other). An answer that
 * isn't JSON — an error page, a proxy that gave up while the server was busy — throws in words, not "Unexpected token 'I' …".
 */
export async function postJson<T = unknown>(url: string, body?: unknown, init: { keepalive?: boolean } = {}): Promise<T> {
  const r = await fetch(url, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), keepalive: init.keepalive });
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Zeff didn't answer as expected (${r.status}${r.statusText ? ` ${r.statusText}` : ""}) — it may have been busy; try again.`);
  }
}
