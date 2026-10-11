/**
 * Zeff's API routes that act (start an AI run, steer an agent, write the calendar inbox, MCP) are
 * not Server Actions — they don't get Next's origin check. A page of another website open in your
 * browser could post to them (a plain form post needs no CORS preflight). Refused here: a request
 * the browser marks as cross-site, or one whose Origin isn't Zeff's own. Agents, scripts and curl
 * send neither header and pass; so do Zeff's own pages.
 */

/** Hosts Zeff is served on: localhost, 127.0.0.1, [::1], *.localhost, the launcher's zeff / *.zeff. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost|zeff|[a-z0-9-]+\.zeff)$/i;

/** Why the request is refused (another website's), or null — it may act. `allowOrigins`: other origins let in (exact). */
export function foreignRequest(req: Request, allowOrigins: readonly string[] = []): string | null {
  const origin = req.headers.get("origin");
  if (origin && allowOrigins.includes(origin)) return null;
  if (req.headers.get("sec-fetch-site") === "cross-site") return "cross-site request";
  if (origin && origin !== "null") {
    try {
      if (!LOCAL_HOST.test(new URL(origin).hostname)) return `foreign origin ${origin}`;
    } catch {
      return "unreadable origin";
    }
  } else if (origin === "null") return "opaque origin";
  return null;
}

/** The 403 for a refused request. */
export const refused = (why: string) => Response.json({ error: "forbidden", message: `Refused: ${why}. Only Zeff's own pages, agents and scripts may call this.` }, { status: 403 });
