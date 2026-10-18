/** The service worker of the capture page: the page itself stays openable without a connection (network first, the last copy as fallback). */
const SCRIPT = `
const KEY = "zeff-capture-1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname !== "/capture") return;
  e.respondWith(
    fetch(e.request).then((r) => { const copy = r.clone(); caches.open(KEY).then((c) => c.put("/capture", copy)); return r; })
      .catch(() => caches.match("/capture").then((r) => r || new Response("Offline", { status: 503 }))),
  );
});
`;

export function GET() {
  return new Response(SCRIPT, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/capture" } });
}
