import { syncAndWait } from "@/lib/sync/registry";

/** Run the mail relation (which mails each open todo is about) now — it runs after each Ticket-Lage too. Answers when it's done. */
export async function POST() {
  return Response.json(await syncAndWait("relations"));
}
