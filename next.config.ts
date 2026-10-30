import os from "node:os";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack's root: ZEFF_TURBOPACK_ROOT (the image build: /app); on Windows the user's home folder (above the checkout and its
  // worktrees, whose node_modules are junctions — forward slashes, as it always was written); elsewhere Next's own guess.
  ...(process.env.ZEFF_TURBOPACK_ROOT ? { turbopack: { root: process.env.ZEFF_TURBOPACK_ROOT } } : process.platform === "win32" ? { turbopack: { root: os.homedir().split("\\").join("/") } } : {}),
  // `npm run deploy` builds into a side folder (ZEFF_DIST_DIR=.next-build) while prod keeps
  // serving .next, and swaps the two just before the restart (scripts/swap-dist.mjs). Everything
  // else — next start, next dev (.next/dev), a plain next build — uses .next.
  ...(process.env.ZEFF_DIST_DIR ? { distDir: process.env.ZEFF_DIST_DIR } : {}),
  // A deploy without its checks (`npm run deploy:sync`, --skip-checks) skips the build's own type check too — the longest part of it.
  ...(process.env.ZEFF_SKIP_TYPECHECK === "1" ? { typescript: { ignoreBuildErrors: true } } : {}),
  // The launcher's dev mode runs `next dev` behind https://zeff: those origins may load dev assets and the HMR socket
  // (ZEFF_DEV_ORIGINS = the launcher's host names, comma separated) — and the phone through `tailscale serve` (<machine>.<tailnet>.ts.net,
  // reachable from the own tailnet only). Ignored by `next start`.
  ...(process.env.ZEFF_DEV_ORIGINS ? { allowedDevOrigins: [...process.env.ZEFF_DEV_ORIGINS.split(","), "127.0.0.1", "**.ts.net"] } : {}),
  // `data/` holds only local runtime state (the SQLite DB + WAL, and the Chrono
  // Chrome profile). None of it is a build dependency, and some files are held
  // open by another process (the dev server has the DB open; a running Chrono
  // Chrome exclusively locks its `Cookies`), which makes output file tracing
  // fail with "os error 32 (file in use)". Keep the whole folder out of the trace. The same for what is big and no part of
  // the app: the launcher and its release packages (dist/ — a trace reading a 380 MB zip ran out of system resources, os
  // error 1450), the worktrees (.claude/), the knowledge server's data, the build before the last.
  outputFileTracingExcludes: {
    "/": ["data/**", "data/**/*", "dist/**", ".claude/**", "knowledge/data/**", ".next-old/**"],
    "/**": ["data/**", "data/**/*", "dist/**", ".claude/**", "knowledge/data/**", ".next-old/**"],
  },
  // Pages that moved — here, not as a redirect() in a page: under the streamed layout that becomes a timed <meta refresh>
  // (WCAG 2.2.1); here it is a plain HTTP redirect. The query goes along (merged under the destination's own: /tickets?ticket=3
  // lands on /todos?part=tickets&ticket=3), the anchor stays the destination's. Only what needs a database lookup redirects in its
  // page (/kanban/…, /keep/…, /personen/…, /vorgaenge/uebersicht).
  redirects() {
    const to = (source: string, destination: string) => ({ source, destination, permanent: false });
    const ifQuery = (source: string, key: string, value: string, destination: string) => ({ ...to(source, destination), has: [{ type: "query" as const, key, value }] });
    return [
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
  },
  experimental: {
    // Context items upload files (screenshots, documents) with their form — up to 20 MB each.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
