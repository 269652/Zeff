/**
 * Asks the server every `ms` — but only while the tab is looked at. A tab in the background (Zeff is open in many) asks nothing; when it
 * comes back it asks at once and goes on. Returns what stops it. Client-safe.
 */
type Doc = { visibilityState: string; addEventListener: (type: "visibilitychange", f: () => void) => void; removeEventListener: (type: "visibilitychange", f: () => void) => void };
type Timers = { setInterval: (f: () => void, ms: number) => unknown; clearInterval: (id: never) => void };

export function pollWhileVisible(fn: () => void, ms: number, doc: Doc = document, timers: Timers = { setInterval: (f, m) => setInterval(f, m), clearInterval: (id) => clearInterval(id as never) }): () => void {
  let id: unknown;
  const start = () => {
    if (id === undefined) id = timers.setInterval(fn, ms);
  };
  const stop = () => {
    if (id !== undefined) {
      timers.clearInterval(id as never);
      id = undefined;
    }
  };
  const onChange = () => {
    if (doc.visibilityState === "visible") {
      fn();
      start();
    } else stop();
  };
  doc.addEventListener("visibilitychange", onChange);
  if (doc.visibilityState === "visible") start();
  return () => {
    stop();
    doc.removeEventListener("visibilitychange", onChange);
  };
}
