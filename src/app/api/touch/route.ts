import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";
import { TOUCH_ACTIONS, type TouchAction } from "@/lib/touch/actions";

/**
 * The browser's half of "touch to approve" (WebAuthn), one POST with a `step`:
 *   assert-options {action, scope}  → {required:false} or {required:true, options}
 *   assert-verify  {challenge, …}   → {ok:true}: the approval now waits for the action
 *   register-options                → options for adding a key (after a touch, when one exists)
 *   register-verify {challenge, label, …} → {ok:true}
 * Only Zeff's own pages (a browser sends the Origin of the page; a script without one gets nothing here — it holds no key).
 */
export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return refused("no origin");
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const touch = await import("@/lib/touch");
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    switch (body.step) {
      case "assert-options": {
        const action = str("action");
        if (!(TOUCH_ACTIONS as readonly string[]).includes(action)) return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
        const options = touch.beginAssertion(action as TouchAction, str("scope"), origin);
        return Response.json(options ? { ok: true, required: true, options } : { ok: true, required: false });
      }
      case "assert-verify":
        touch.finishAssertion(origin, str("challenge"), { id: str("id"), clientDataJSON: str("clientDataJSON"), authenticatorData: str("authenticatorData"), signature: str("signature") });
        return Response.json({ ok: true });
      case "register-options":
        return Response.json({ ok: true, options: touch.beginRegistration(origin) });
      case "register-verify": {
        const cred = touch.finishRegistration(
          origin,
          str("challenge"),
          { id: str("id"), clientDataJSON: str("clientDataJSON"), authenticatorData: str("authenticatorData"), publicKey: str("publicKey"), algorithm: Number(body.algorithm) },
          str("label"),
        );
        return Response.json({ ok: true, id: cred.id });
      }
      default:
        return Response.json({ ok: false, error: "Unknown step." }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
