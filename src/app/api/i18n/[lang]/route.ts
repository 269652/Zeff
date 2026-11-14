import { NextResponse } from "next/server";
import { pluginStringsFor, pluginStringsVersion } from "@/lib/i18n/plugin-strings";

/**
 * The runtime plugins' texts in one language, as a script for the browser (the root layout loads it before React starts): it puts them
 * into window.__zeffStrings, where t() in the browser finds them (lib/i18n/shared.ts). Asked with ?v=<their version> — the answer is
 * cached for good; new texts are a new address. Texts only — the same for every account.
 */
export async function GET(req: Request, ctx: { params: Promise<{ lang: string }> }) {
  const { lang } = await ctx.params;
  if (!/^[a-z]{2}$/.test(lang)) return new NextResponse("No such language.", { status: 404 });
  const strings = pluginStringsFor(lang);
  const asked = new URL(req.url).searchParams.get("v");
  const fixed = !!asked && asked === pluginStringsVersion(lang);
  // (< and the two line separators written as escapes — built from their codes)
  const unsafe = new Set([60, 0x2028, 0x2029]);
  const esc = (code: number) => String.fromCharCode(92) + "u" + code.toString(16).padStart(4, "0");
  const json = Array.from(JSON.stringify(strings), (c) => (unsafe.has(c.charCodeAt(0)) ? esc(c.charCodeAt(0)) : c)).join("");
  return new NextResponse(`(window.__zeffStrings = window.__zeffStrings || {})[${JSON.stringify(lang)}] = ${json};\n`, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": fixed ? "public, max-age=31536000, immutable" : "no-cache" },
  });
}
