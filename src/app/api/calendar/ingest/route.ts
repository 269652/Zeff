import { isInstalled } from "@/plugins/state";
import { NextResponse, type NextRequest } from "next/server";
import { clearInbox, inboxCount, mergeIntoInbox } from "@/lib/calendar/inbox";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * Receives calendar events extracted by the browser bookmarklet (which runs in
 * your authenticated Outlook session) and stores them in the server inbox. This
 * is the no-OAuth bridge: the browser has the session, the server gets the data.
 *
 * CORS is open to Outlook's own origins only (a bookmarklet may post from there) — any
 * other website is refused, so none can fill or clear the inbox. Only calendar-shaped
 * event data is accepted, and it is stored locally — nothing is sent out.
 */
const OUTLOOK = ["https://outlook.office.com", "https://outlook.office365.com", "https://outlook.cloud.microsoft", "https://outlook.live.com"];

function cors(res: NextResponse, req: Request): NextResponse {
  const origin = req.headers.get("origin");
  if (!origin || !OUTLOOK.includes(origin)) return res;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  // Private Network Access: allow a public site (outlook.office.com) to reach this local server.
  res.headers.set("Access-Control-Allow-Private-Network", "true");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return cors(new NextResponse(null, { status: 204 }), req);
}

export async function GET(req: NextRequest) {
  if (!isInstalled("outlook-calendar")) return new Response("Plugin not installed", { status: 404 });
  return cors(NextResponse.json({ ok: true, count: inboxCount() }), req);
}

export async function POST(req: NextRequest) {
  if (!isInstalled("outlook-calendar")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req, OUTLOOK);
  if (why) return refused(why);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return cors(NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }), req);
  }

  const events = Array.isArray(body)
    ? body
    : Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: unknown[] }).events
      : Array.isArray((body as { value?: unknown }).value)
        ? (body as { value: unknown[] }).value
        : null;

  if (!events) {
    return cors(
      NextResponse.json(
        { ok: false, error: "Expected { events: [...] } or a bare array." },
        { status: 400 },
      ),
      req,
    );
  }
  if (events.length === 0 && req.nextUrl.searchParams.get("clear") === "1") {
    clearInbox();
    return cors(NextResponse.json({ ok: true, accepted: 0, total: 0, cleared: true }), req);
  }

  const { accepted, total } = mergeIntoInbox(events);
  return cors(NextResponse.json({ ok: true, accepted, total }), req);
}
