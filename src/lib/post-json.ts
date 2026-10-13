/** POST a JSON body to a route and read the JSON answer (a route, because server actions queue behind each other). */
export async function postJson<T = unknown>(url: string, body?: unknown, init: { keepalive?: boolean } = {}): Promise<T> {
  const r = await fetch(url, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), keepalive: init.keepalive });
  return (await r.json()) as T;
}
