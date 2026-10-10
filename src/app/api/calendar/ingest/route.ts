import { isInstalled } from "@/plugins/state";
import { NextResponse, type NextRequest } from "next/server";
import { clearInbox, inboxCount, mergeIntoInbox } from "@/lib/calendar/inbox";

/**
 * Receives calendar events extracted by the browser bookmarklet (which runs in
 * your authenticated Outlook session) and stores them in the server inbox. This
 * is the no-OAuth bridge: the browser has the session, the server gets the data.
 *
 * CORS is open because the bookmarklet posts from the outlook.office.com /
 * outlook.cloud.microsoft origin. Only calendar-shaped event data is accepted,
 * and it is stored locally in the Zeff database directory — nothing is sent out.
 */
function cors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  // Private Network Access: allow a public site (outlook.office.com) to reach this local server.
  res.headers.set("Access-Control-Allow-Private-Network", "true");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  if (!isInstalled("outlook-calendar")) return new Response("Plugin not installed", { status: 404 });
  return cors(NextResponse.json({ ok: true, count: inboxCount() }));
}

export async function POST(req: NextRequest) {
  if (!isInstalled("outlook-calendar")) return new Response("Plugin not installed", { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return cors(NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }));
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
    );
  }
  if (events.length === 0 && req.nextUrl.searchParams.get("clear") === "1") {
    clearInbox();
    return cors(NextResponse.json({ ok: true, accepted: 0, total: 0, cleared: true }));
  }

  const { accepted, total } = mergeIntoInbox(events);
  return cors(NextResponse.json({ ok: true, accepted, total }));
}
