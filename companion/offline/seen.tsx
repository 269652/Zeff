import { useEffect, useRef, useState } from "react";
import { fmtDay, fmtTime, tr } from "./words";

type Seen = { path: string; title: string; at: string };

/** The pages kept by the service worker (companion/app/sw.js: "zeff-pages") — newest first. */
async function seenPages(): Promise<Seen[]> {
  if (typeof caches === "undefined") return [];
  const c = await caches.open("zeff-pages");
  const out: Seen[] = [];
  for (const req of await c.keys()) {
    const res = await c.match(req);
    if (!res) continue;
    const u = new URL(req.url);
    out.push({ path: u.pathname + u.search, title: decodeURIComponent(res.headers.get("x-zc-title") ?? "") || u.pathname, at: res.headers.get("x-zc-at") ?? "" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** A page's area, from its path (the account's prefix left out): Learn, Review, Messages … — for the list. */
function areaOf(path: string): string {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const known = ["learn", "review", "mail", "chat", "todos", "heute", "kalender", "calendar", "workspace", "work", "people", "personen", "news", "documents", "settings", "finances", "boards", "t"];
  const at = parts.findIndex((p) => known.includes(p));
  const first = at >= 0 ? parts[at] : parts[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1) : "Zeff";
}

/**
 * What a page as last seen can't do here: every button, field and form greyed out and closed off (nothing in it can
 * reach the PC) — links stay, so another kept page opens. Into the frame's document (same origin, no scripts of its own).
 */
function closeOff(frame: HTMLIFrameElement | null) {
  const doc = frame?.contentDocument;
  if (!doc || doc.getElementById("zo-seen-style")) return;
  const style = doc.createElement("style");
  style.id = "zo-seen-style";
  style.textContent = `button, input, select, textarea, [role="button"], [contenteditable="true"], summary, label { opacity: .45 !important; pointer-events: none !important; cursor: not-allowed !important; }
nav a, header a { pointer-events: auto !important; opacity: 1 !important; }`;
  doc.head?.appendChild(style);
  for (const el of Array.from(doc.querySelectorAll("button, input, select, textarea, fieldset"))) (el as HTMLButtonElement).disabled = true;
  for (const el of Array.from(doc.querySelectorAll("[contenteditable]"))) el.setAttribute("contenteditable", "false");
  for (const f of Array.from(doc.querySelectorAll("form"))) f.addEventListener("submit", (e) => e.preventDefault(), true);
}

/**
 * Everything else of Zeff (learning, the review, mails, chats, the briefing …) as you last saw it on this phone: to read,
 * as it was then — its buttons and fields greyed out (they need the PC), the page without its scripts. Fresh again
 * when the PC is reachable.
 */
export function SeenView() {
  const [pages, setPages] = useState<Seen[] | null>(null);
  const [open, setOpen] = useState<Seen | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let live = true;
    void seenPages().then((p) => live && setPages(p));
    return () => void (live = false);
  }, []);
  if (open)
    return (
      <div className="space-y-2" data-zo="seen-page">
        <div className="flex items-center gap-2">
          <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={() => setOpen(null)}>
            ← {tr("Back")}
          </button>
          <span className="ml-auto text-xs text-zinc-500">{tr("seenAt", { day: fmtDay(open.at), time: fmtTime(open.at) })}</span>
        </div>
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {tr("asSeen")}
        </p>
        {/* No scripts: the page as it was rendered — links stay inside (kept pages open, others say they need the PC). */}
        <iframe
          ref={frame}
          title={open.title}
          src={open.path}
          sandbox="allow-same-origin allow-popups"
          className="card block h-[calc(100dvh-13rem)] w-full overflow-hidden"
          onLoad={() => closeOff(frame.current)}
        />
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">{tr("seenIntro")}</p>
      {pages && !pages.length && <p className="px-1 text-sm text-zinc-500">{tr("seenNone")}</p>}
      {!!pages?.length && (
        <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
          {pages.map((p) => (
            <li key={p.path} data-zo="seen">
              <button type="button" className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60" onClick={() => setOpen(p)}>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.title.replace(/\s*·\s*Zeff$/, "")}</span>
                <span className="text-xs text-zinc-500">
                  {areaOf(p.path)} · {fmtDay(p.at)} {fmtTime(p.at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
