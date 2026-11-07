/**
 * A long call from a view, past the queue of the page's actions. What goes wrong comes back as an answer, like an action's. A connection
 * lost is tried once more: on a dev server the route's first call can lose it while the route compiles.
 */
export async function postJson<T extends object>(url: string, body: unknown, noAnswer: string): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  const call = async () => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return (await r?.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  };
  const data = (await call()) ?? (await call());
  if (!data) return { ok: false, error: noAnswer };
  return data.ok ? ({ ...data, ok: true } as { ok: true } & T) : { ok: false, error: data.error ?? noAnswer };
}
