/**
 * Where the automation browser's debug port is, seen from where Zeff runs. On the host it is 127.0.0.1:<port>. In a container
 * (ZEFF_CDP_BASE set) the browser is on the host: its ports are reached through the bridge (scripts/chrome-bridge.mjs) at
 * <base>:<port + offset>/<token>, and a stopped browser is started by asking the bridge (POST .../launch).
 * Plain JS (no dependencies): used by src/db/accounts.ts, src/plugins/signal/endpoint.ts and scripts/chrome-cdp.mjs.
 */

/** @typedef {Record<string, string | undefined>} Env */

/** The bridge's settings from the environment, or null when Zeff runs on the host itself. */
export function bridgeEnv(env = process.env) {
  const base = String(env.ZEFF_CDP_BASE ?? "").replace(/\/+$/, "");
  const token = String(env.ZEFF_BRIDGE_TOKEN ?? "");
  if (!base || !token) return null;
  return { base, token, offset: Number(env.ZEFF_CDP_OFFSET) || 1000, controlPort: Number(env.ZEFF_BRIDGE_CONTROL_PORT) || 9230 };
}

/** The debug endpoint of the browser on a debug port (the host's number): direct, or through the bridge. */
export function cdpEndpoint(port, env = process.env) {
  const b = bridgeEnv(env);
  return b ? `${b.base}:${port + b.offset}/${b.token}` : `http://127.0.0.1:${port}`;
}

/** The debug port (the host's number) an endpoint through the bridge stands for; null for any other endpoint. */
export function bridgedPort(endpoint, env = process.env) {
  const b = bridgeEnv(env);
  if (!b) return null;
  try {
    const u = new URL(endpoint);
    const base = new URL(b.base);
    if (u.hostname !== base.hostname || !u.pathname.replace(/\/+$/, "").endsWith(`/${b.token}`)) return null;
    const port = Number(u.port) - b.offset;
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/** Ask the bridge to start the browser on a debug port (it knows the profile of that port's account). Throws with the bridge's words. */
export async function bridgeLaunch(port, urls = [], env = process.env, fetchImpl = fetch) {
  const b = bridgeEnv(env);
  if (!b) throw new Error("No bridge to the host's browser is set (ZEFF_CDP_BASE, ZEFF_BRIDGE_TOKEN).");
  let res;
  try {
    res = await fetchImpl(`${b.base}:${b.controlPort}/${b.token}/launch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ port, urls }), signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(`The bridge to the host's browser doesn't answer (${b.base}:${b.controlPort}) — start it on the host: npm run docker:bridge. ${e?.message ?? e}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) throw new Error(`The bridge could not start the browser: ${body?.error ?? res.status}`);
}
