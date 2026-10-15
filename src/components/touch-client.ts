"use client";

import { startTransition } from "react";

/**
 * The browser's half of "touch to approve" (see src/lib/touch): ask the security key, hand its answer to /api/touch.
 * `touchApprove` before an action that may wait for a touch (it answers ok at once when none is needed);
 * `withTouch` wraps a form action so its button asks first.
 */

export type TouchResult = { ok: true } | { ok: false; error: string };

export const toBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
export const toB64u = (buf: ArrayBuffer): string => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

type RegisterOptions = { challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string }; excludeCredentials: { id: string; type: "public-key" }[] };
type AssertOptions = { challenge: string; rpId: string; allowCredentials: { id: string; type: "public-key" }[] };
type Answer = { ok?: boolean; error?: string; message?: string; required?: boolean; options?: AssertOptions & RegisterOptions };

async function post(body: Record<string, unknown>): Promise<Answer> {
  const res = await fetch("/api/touch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
  return json;
}

/** A WebAuthn ceremony only works on a name (https://zeff, localhost) — not on an IP address, which the browser refuses as the site. */
export const onIpAddress = (): boolean => /^(d+.d+.d+.d+|[.*])$/.test(location.hostname);
export const IP_HINT = "A security key cannot be used on an IP address (127.0.0.1): open Zeff at https://zeff (or http://localhost).";

export function keyError(err: unknown): string {
  console.error("[security key]", err);
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) return "Cancelled or timed out — the key was not touched. (" + err.name + (err.message ? ": " + err.message : "") + ")";
  if (err instanceof DOMException && err.name === "InvalidStateError") return "This key is registered already.";
  if (err instanceof DOMException) return err.name + ": " + err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Ask for the touch the action needs (nothing when none is). `scope` as the page knows it, e.g. "chrono|<week>". */
export async function touchApprove(action: string, scope = ""): Promise<TouchResult> {
  try {
    const first = await post({ step: "assert-options", action, scope });
    if (!first.required) return { ok: true };
    if (!window.PublicKeyCredential) return { ok: false, error: "This browser cannot use a security key here (it needs https or localhost)." };
    const o = first.options as AssertOptions;
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: toBytes(o.challenge),
        rpId: o.rpId,
        allowCredentials: o.allowCredentials.map((c) => ({ type: c.type, id: toBytes(c.id) })),
        userVerification: "discouraged",
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, error: "No answer from the key." };
    const r = cred.response as AuthenticatorAssertionResponse;
    await post({
      step: "assert-verify",
      challenge: o.challenge,
      id: cred.id,
      clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: keyError(err) };
  }
}

/** Add a key (with a key already registered: touch one first). */
export async function touchRegister(label: string, hasKeys: boolean): Promise<TouchResult> {
  try {
    if (onIpAddress()) return { ok: false, error: IP_HINT };
    if (hasKeys) {
      const t = await touchApprove("touch-settings");
      if (!t.ok) return t;
    }
    if (!window.PublicKeyCredential) return { ok: false, error: "This browser cannot use a security key here (it needs https or localhost)." };
    const o = (await post({ step: "register-options" })).options as RegisterOptions;
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: toBytes(o.challenge),
        rp: o.rp,
        user: { id: toBytes(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: o.excludeCredentials.map((c) => ({ type: c.type, id: toBytes(c.id) })),
        // The key itself (USB), not Windows Hello or a phone.
        authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "discouraged", userVerification: "discouraged" },
        attestation: "none",
        timeout: 60000,
        ...({ hints: ["security-key"] } as object),
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, error: "No answer from the key." };
    const r = cred.response as AuthenticatorAttestationResponse;
    const spki = r.getPublicKey();
    if (!spki) return { ok: false, error: "This browser did not hand over the key's public key." };
    await post({
      step: "register-verify",
      challenge: o.challenge,
      label,
      id: cred.id,
      clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.getAuthenticatorData()),
      publicKey: toB64u(spki),
      algorithm: r.getPublicKeyAlgorithm(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: keyError(err) };
  }
}

/**
 * A form action that asks for the touch first, then runs `run` with the form. A button that names `skip` ("dryRun") with
 * value "on" goes straight through (read-only). `scope` is read when the form is sent.
 */
export function withTouch(action: string, scope: () => string, run: (fd: FormData) => void, onError: (message: string | null) => void, skip?: string) {
  return async (fd: FormData) => {
    if (!skip || fd.get(skip) !== "on") {
      const r = await touchApprove(action, scope());
      if (!r.ok) return onError(r.error);
    }
    onError(null);
    startTransition(() => run(fd));
  };
}
