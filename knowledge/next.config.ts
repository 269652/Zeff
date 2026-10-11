import path from "node:path";
import type { NextConfig } from "next";

/**
 * The knowledge server: Zeff's sibling, its own Next app on its own port (9555) — it reads
 * Confluence, compiles it with Copilot into a knowledge graph and answers questions about it.
 * It lives in Zeff's repository and uses its packages (node_modules one folder up) and a few of its
 * modules (the Copilot CLI runner); its data is its own (knowledge/data/).
 */
const root = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // `npm run deploy -- --knowledge` builds into a side folder and swaps it in (see ../next.config.ts).
  ...(process.env.ZEFF_DIST_DIR ? { distDir: process.env.ZEFF_DIST_DIR } : {}),
  turbopack: { root },
  outputFileTracingRoot: root,
  outputFileTracingExcludes: {
    "/": ["data/**", "../data/**"],
    "/**": ["data/**", "../data/**"],
  },
};

export default nextConfig;
