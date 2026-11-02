/**
 * Pages that moved — next.config.ts serves these as plain HTTP redirects (not a redirect() in a page: under the streamed
 * layout that becomes a timed <meta refresh>, WCAG 2.2.1). The query goes along (merged under the destination's own:
 * /tickets?ticket=3 lands on /todos?part=tickets&ticket=3), the anchor stays the destination's. Only what needs a database
 * lookup redirects in its page (/kanban/…, /keep/…, /personen/…, /vorgaenge/uebersicht).
 *
 * Kept here (no imports) so the proxy can do the same under an account's prefix: next.config's redirects run before the proxy
 * and so never see "/privat/boards" as "/boards" (src/proxy.ts → movedPage).
 */
export type MovedPage = { source: string; destination: string; permanent: false; has?: { type: "query"; key: string; value: string }[] };

const to = (source: string, destination: string): MovedPage => ({ source, destination, permanent: false });
const ifQuery = (source: string, key: string, value: string, destination: string): MovedPage => ({ ...to(source, destination), has: [{ type: "query", key, value }] });

export const MOVED_PAGES: MovedPage[] = [
  // The Boards tab is the Todos tab now.
  to("/boards", "/todos"),
  // The AI steps are the prompts now: the AI settings' prompts.
  to("/auswerten", "/settings/ai#prompts"),
  to("/settings/prompts", "/settings/ai#prompts"),
  to("/workspace/settings/prompts", "/settings/ai#prompts"),
  to("/settings/ai-quality", "/settings/ai#ai-quality"),
  to("/llm", "/settings/ai#backends"),
  to("/apps/keep", "/workspace"),
  to("/connections", "/settings/connections"),
  to("/logins", "/settings/connections#sign-ins"),
  to("/sync-settings", "/settings/connections#syncs"),
  to("/gmail", "/settings/connections#gmail-accounts"),
  // A Google sign-in's answer (?error= / ?connected=) says which provider it was.
  ifQuery("/google-drive", "error", "(?<e>.*)", "/settings/connections?provider=drive#google-drive"),
  ifQuery("/google-drive", "connected", "(?<c>.*)", "/settings/connections?provider=drive#google-drive"),
  to("/google-drive", "/settings/connections#google-drive"),
  to("/kalender/einstellungen", "/settings/calendar"),
  to("/workspace/settings", "/workspace/settings/sources"),
  to("/workspace/sources", "/workspace/settings/sources"),
  to("/settings/all", "/settings"),
  // The review queue and the open loops are a part of Today (a loops view: ?view= → ?loops=).
  to("/review", "/heute#review"),
  ifQuery("/loops", "view", "(?<view>.+)", "/heute?loops=:view#loops"),
  to("/loops", "/heute#loops"),
  // Tickets are a toggle inside Todos (their filters go along).
  to("/tickets", "/todos?part=tickets"),
  // The apps are the inbox's filters: Teams (?kind=, ?q=), Gmail (?folder=, ?q=), Signal and WhatsApp (?chat= a chat's
  // id opens it, a name searches for it; ?q=).
  to("/teams", "/mail?channel=teams"),
  to("/apps/gmail", "/mail?channel=gmail"),
  ifQuery("/apps/signal", "chat", "(?<chat>sg:.+)", "/mail?channel=signal&open=:chat"),
  ifQuery("/apps/signal", "chat", "(?<chat>.+)", "/mail?channel=signal&q=:chat"),
  to("/apps/signal", "/mail?channel=signal"),
  ifQuery("/apps/whatsapp", "chat", "(?<chat>wa:.+)", "/mail?channel=whatsapp&open=:chat"),
  ifQuery("/apps/whatsapp", "chat", "(?<chat>.+)", "/mail?channel=whatsapp&q=:chat"),
  to("/apps/whatsapp", "/mail?channel=whatsapp"),
];

/**
 * Where a moved page went, as next.config's redirect would send it (the path, the query merged under the destination's own,
 * the destination's anchor) — or null: it didn't move. `search` with or without its "?".
 */
export function movedPage(pathname: string, search: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const query = new URLSearchParams(search);
  for (const rule of MOVED_PAGES) {
    if (rule.source !== path) continue;
    const groups: Record<string, string> = {};
    let ok = true;
    for (const h of rule.has ?? []) {
      const v = query.get(h.key);
      const m = v === null ? null : new RegExp(`^(?:${h.value})$`).exec(v);
      if (!m) {
        ok = false;
        break;
      }
      Object.assign(groups, m.groups ?? {});
    }
    if (!ok) continue;
    const dest = rule.destination.replace(/:([A-Za-z_]\w*)/g, (all, name: string) => (name in groups ? encodeURIComponent(groups[name]) : all));
    const [beforeHash, hash] = dest.split("#");
    const [destPath, destQuery] = beforeHash.split("?");
    const merged = new URLSearchParams(destQuery ?? "");
    for (const [k, v] of query) if (!merged.has(k)) merged.append(k, v);
    const q = merged.toString();
    return `${destPath}${q ? `?${q}` : ""}${hash !== undefined ? `#${hash}` : ""}`;
  }
  return null;
}
