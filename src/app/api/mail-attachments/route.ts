import { connection } from "next/server";

/**
 * Where the attachments run is (the “Fetch attachments” button polls it): running or not, the mail
 * sync it waits for or the mail it's on, what it made so far, and how the last run ended. The
 * account you're in. A GET only reads; a request from another site gets nothing.
 */
export async function GET(req: Request) {
  await connection();
  const { foreignRequest, refused } = await import("@/lib/request-guard");
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { attachmentProgress } = await import("@/lib/mail/attachments-sync");
  return Response.json(attachmentProgress(), { headers: { "cache-control": "no-store" } });
}
