import { isInstalled } from "@/plugins/state";
import { syncAndWait } from "@/lib/sync/registry";
import { foreignRequest, refused } from "@/lib/request-guard";

/** Run the mail relation (which mails each open todo is about) now — it runs after each Ticket-Lage too. Answers when it's done. Not for other websites (it's an AI run). */
export async function POST(req: Request) {
  const why = foreignRequest(req);
  if (why) return refused(why);
  if (!isInstalled("outlook-mail") && !isInstalled("gmail")) return new Response("Plugin not installed", { status: 404 });
  return Response.json(await syncAndWait("relations"));
}
