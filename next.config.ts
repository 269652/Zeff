import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run deploy` builds into a side folder (ZEFF_DIST_DIR=.next-build) while prod keeps
  // serving .next, and swaps the two just before the restart (scripts/swap-dist.mjs). Everything
  // else — next start, next dev (.next/dev), a plain next build — uses .next.
  ...(process.env.ZEFF_DIST_DIR ? { distDir: process.env.ZEFF_DIST_DIR } : {}),
  // The launcher's dev mode runs `next dev` behind https://zeff: those origins may load dev assets and the HMR socket
  // (ZEFF_DEV_ORIGINS = the launcher's host names, comma separated). Ignored by `next start`.
  ...(process.env.ZEFF_DEV_ORIGINS ? { allowedDevOrigins: [...process.env.ZEFF_DEV_ORIGINS.split(","), "127.0.0.1"] } : {}),
  // `data/` holds only local runtime state (the SQLite DB + WAL, and the Chrono
  // Chrome profile). None of it is a build dependency, and some files are held
  // open by another process (the dev server has the DB open; a running Chrono
  // Chrome exclusively locks its `Cookies`), which makes output file tracing
  // fail with "os error 32 (file in use)". Keep the whole folder out of the trace.
  outputFileTracingExcludes: {
    "/": ["data/**", "data/**/*"],
    "/**": ["data/**", "data/**/*"],
  },
  // The Boards tab is the Todos tab now — old links (bookmarks, notifications) land there.
  redirects() {
    return [
      { source: "/boards", destination: "/todos", permanent: false },
      // The AI steps are the prompts now: Settings → Prompts.
      { source: "/auswerten", destination: "/settings/prompts", permanent: false },
    ];
  },
  experimental: {
    // Context items upload files (screenshots, documents) with their form — up to 20 MB each.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
