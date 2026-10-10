import { isInstalled } from "@/plugins/state";
import { syncAndWait } from "@/lib/sync/registry";

/** Run the mail relation (which mails each open todo is about) now — it runs after each Ticket-Lage too. Answers when it's done. */
export async function POST() {
  if (!isInstalled("outlook-mail") && !isInstalled("gmail")) return new Response("Plugin not installed", { status: 404 });
  return Response.json(await syncAndWait("relations"));
}
