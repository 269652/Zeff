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
  // The Boards tab is the Todos tab now — old links (bookmarks, notifications) land there.
  redirects() {
    return [
      { source: "/boards", destination: "/todos", permanent: false },
      // The AI steps are the prompts now: Settings → Prompts.
      { source: "/auswerten", destination: "/settings/prompts", permanent: false },
      // Pages that moved — here, not as a redirect() in a page: under the streamed layout that becomes a timed
      // <meta refresh> (WCAG 2.2.1); here it is a plain HTTP redirect (the query, e.g. a sign-in's, goes along).
      { source: "/apps/keep", destination: "/keep", permanent: false },
      { source: "/connections", destination: "/settings/connections", permanent: false },
      { source: "/kalender/einstellungen", destination: "/settings/calendar", permanent: false },
      { source: "/workspace/settings", destination: "/workspace/settings/sources", permanent: false },
      { source: "/workspace/sources", destination: "/workspace/settings/sources", permanent: false },
    ];
  },
  experimental: {
    // Context items upload files (screenshots, documents) with their form — up to 20 MB each.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
