import { onChange } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * GET /api/events — server-sent events: "change" (data: work | todos) whenever a run starts or
 * ends or a todo changes, so open pages refresh themselves; a comment every 25 s keeps it open.
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          stop();
        }
      };
      send("retry: 3000\n\n");
      const off = onChange((topic) => send(`event: change\ndata: ${topic}\n\n`));
      const beat = setInterval(() => send(": ping\n\n"), 25000);
      stop = () => {
        off();
        clearInterval(beat);
      };
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          // closed already
        }
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
