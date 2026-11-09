import { useEffect, useState } from "react";
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

/**
 * Everything else of Zeff (mails, chats, the briefing, tickets …) as you last saw it on this phone: read-only, as it was
 * then — the page without its scripts (nothing in it acts while the PC is away). Fresh again when the PC is reachable.
 */
export function SeenView() {
  const [pages, setPages] = useState<Seen[] | null>(null);
  const [open, setOpen] = useState<Seen | null>(null);
  useEffect(() => {
    let live = true;
    void seenPages().then((p) => live && setPages(p));
    return () => void (live = false);
  }, []);
  if (open)
    return (
      <div className="zo-seen">
        <div className="zo-seen-bar">
          <button type="button" className="zo-back" onClick={() => setOpen(null)}>
            ← {tr("Back")}
          </button>
          <small>{tr("seenAt", { day: fmtDay(open.at), time: fmtTime(open.at) })}</small>
        </div>
        {/* No scripts: the page as it was rendered (links stay inside, kept pages open, others say they need the PC). */}
        <iframe title={open.title} src={open.path} sandbox="allow-same-origin allow-popups" className="zo-seen-frame" />
      </div>
    );
  return (
    <div className="zo-page">
      <p className="zo-muted">{tr("seenIntro")}</p>
      {pages && !pages.length && <p className="zo-muted">{tr("seenNone")}</p>}
      <ul className="zo-list">
        {(pages ?? []).map((p) => (
          <li key={p.path}>
            <button type="button" className="zo-row" onClick={() => setOpen(p)}>
              <strong>{p.title.replace(/\s*·\s*Zeff$/, "")}</strong>
              <small>
                {p.path} · {fmtDay(p.at)} {fmtTime(p.at)}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
