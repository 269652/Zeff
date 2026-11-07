/**
 * An answer that takes longer than Next's proxy waits: a page under an account's prefix reaches the server through it, and it hangs up
 * on a connection that is silent for 30 s. A space every few seconds keeps it open; spaces before JSON are still JSON.
 */
const BEAT_MS = 5000;

export function slowJson(work: () => Promise<unknown>): Response {
  const bytes = new TextEncoder();
  let beat: ReturnType<typeof setInterval> | undefined;
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (text: string) => void (open && c.enqueue(bytes.encode(text)));
      send(" ");
      beat = setInterval(() => send(" "), BEAT_MS);
      void work()
        .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
        .then((answer) => {
          clearInterval(beat);
          send(JSON.stringify(answer));
          if (open) c.close();
          open = false;
        });
    },
    cancel() {
      open = false;
      clearInterval(beat);
    },
  });
  // (no-transform: compressed, the spaces would wait in a buffer.)
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store, no-transform" } });
}
