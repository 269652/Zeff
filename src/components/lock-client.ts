"use client";

import { toB64u, toBytes, type TouchResult } from "@/components/touch-client";

/**
 * The browser's half of the lock's switch (Settings → Lock; the lock page itself is src/lib/lock/page.ts). Asks the key for
 * its PIN and a touch, hands the answer to /api/lock.
 */

async function post(body: Record<string, unknown>): Promise<{ options?: { challenge: string; rpId: string; allowCredentials: { id: string; type: "public-key" }[] } }> {
  const res = await fetch("/api/lock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Switch the lock on: the key's PIN and a touch prove the key works, and the session that follows is this browser's. */
export async function lockEnable(): Promise<TouchResult> {
  try {
    if (!window.PublicKeyCredential) return { ok: false, error: "This browser cannot use a security key here (it needs https or localhost)." };
    const o = (await post({ step: "unlock-options" })).options!;
    const cred = (await navigator.credentials.get({
      publicKey: { challenge: toBytes(o.challenge), rpId: o.rpId, allowCredentials: o.allowCredentials.map((c) => ({ type: c.type, id: toBytes(c.id) })), userVerification: "required", timeout: 60000 },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, error: "No answer from the key." };
    const r = cred.response as AuthenticatorAssertionResponse;
    await post({ step: "unlock-verify", enable: true, challenge: o.challenge, id: cred.id, clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature) });
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) return { ok: false, error: "Cancelled or timed out — the key was not touched." };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** "lock-now" (every session ends) or "disable" (the lock is off). */
export async function lockStep(step: "lock-now" | "disable"): Promise<TouchResult> {
  try {
    await post({ step });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
