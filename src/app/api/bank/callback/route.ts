import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";

/** GET /api/bank/callback?code=…&state=… — your bank (through Enable Banking) sends you back here after you allowed access. */
export async function GET(req: NextRequest) {
  if (!isInstalled("cases")) return new Response("Plugin not installed", { status: 404 });
  const origin = getPublicOrigin(req);
  const db = await (await import("@/plugins/cases/database")).casesDatabase();
  const back = (query: string) => NextResponse.redirect(new URL(`${db ? `/workspace/${db}` : "/workspace"}${query}`, origin));
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(`?bank=${encodeURIComponent(`${sp.get("error")}${sp.get("error_description") ? `: ${sp.get("error_description")}` : ""}`)}`);
  const code = sp.get("code");
  if (!code) return back(`?bank=${encodeURIComponent("No code came back from the bank.")}`);
  try {
    const sync = await import("@/plugins/cases/bank-sync");
    await sync.finishBankAuth(code, sp.get("state") ?? "");
    // The bookings right away, matched.
    await sync.syncBank();
    const bank = await import("@/plugins/cases/bank");
    bank.matchPayments();
    bank.overdueWarnings(new Date().toISOString().slice(0, 10));
    return back("?bank=connected");
  } catch (e) {
    return back(`?bank=${encodeURIComponent(errorMessage(e))}`);
  }
}
