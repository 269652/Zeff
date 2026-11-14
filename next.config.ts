import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { MOVED_PAGES } from "./src/lib/moved-pages";

// Mods (docs/mods.md): every exported function and component of src/ behind a named hook, put in by a build loader — the sources stay
// as they are. In every build (`next build`: the release has them) and in `next dev`; ZEFF_MOD_HOOKS=0: never (Zeff exactly as written).
// Told by the phase Next hands the config — not by the command line: `next dev` runs its server in a process of its own
// (start-server.js) whose arguments don't say "dev", and that process is the one whose Turbopack loads the files.
const hooksFor = (phase: string): boolean =>
  process.env.ZEFF_MOD_HOOKS === "1" ||
  (process.env.ZEFF_MOD_HOOKS !== "0" &&
    (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD || process.argv.includes("build") || process.argv.includes("dev")));
let catalogWritten = false;
function writeCatalog(): void {
  if (catalogWritten) return;
  catalogWritten = true;
  try {
    // (the catalog of the hooks beside the build: what the Mods page and the AI list)
    createRequire(path.join(process.cwd(), "next.config.ts"))("./scripts/mods/catalog.cjs").writeCatalog(process.cwd());
  } catch (e) {
    console.warn("[mods] the catalog of hooks was not written:", e);
  }
}
// (No `as`: the file stays the TypeScript it was — `as: "*.ts"` would name it "x.ts.ts". Next's own files of a special meaning —
// proxy, middleware, instrumentation — and the mods' runtime are left out.)
const hookRule = {
  condition: {
    all: [
      { not: "foreign" as const },
      { path: /\/src\// },
      {
        not: {
          path: /\/src\/(lib\/mods\/|proxy\.ts$|middleware\.ts$|instrumentation)/,
        },
      },
    ],
  },
  loaders: [{ loader: path.resolve("scripts/mods/hook-loader.cjs"), options: {} }],
};
const configFor = (modHooks: boolean): NextConfig => {
  const turbopackRules = modHooks ? { rules: { "*.ts": hookRule, "*.tsx": hookRule } } : {};
  if (modHooks) writeCatalog();

  const nextConfig: NextConfig = {
    // Turbopack's root: ZEFF_TURBOPACK_ROOT (the image build: /app); on Windows the user's home folder (above the checkout and its
    // worktrees, whose node_modules are junctions — forward slashes, as it always was written); elsewhere Next's own guess.
    ...(process.env.ZEFF_TURBOPACK_ROOT
      ? {
          turbopack: {
            root: process.env.ZEFF_TURBOPACK_ROOT,
            ...turbopackRules,
          },
        }
      : process.platform === "win32"
        ? {
            turbopack: {
              root: os.homedir().split("\\").join("/"),
              ...turbopackRules,
            },
          }
        : modHooks
          ? { turbopack: turbopackRules }
          : {}),
    // `npm run deploy` builds into a side folder (ZEFF_DIST_DIR=.next-build) while prod keeps
    // serving .next, and swaps the two just before the restart (scripts/swap-dist.mjs). Everything
    // else — next start, next dev (.next/dev), a plain next build — uses .next.
    ...(process.env.ZEFF_DIST_DIR ? { distDir: process.env.ZEFF_DIST_DIR } : {}),
    // A deploy without its checks (`npm run deploy:sync`, --skip-checks) skips the build's own type check too — the longest part of it.
    ...(process.env.ZEFF_SKIP_TYPECHECK === "1" ? { typescript: { ignoreBuildErrors: true } } : {}),
    // The launcher's dev mode runs `next dev` behind https://zeff: those origins may load dev assets and the HMR socket
    // (ZEFF_DEV_ORIGINS = the launcher's host names, comma separated) — and the phone through `tailscale serve` (<machine>.<tailnet>.ts.net,
    // reachable from the own tailnet only). Ignored by `next start`.
    ...(process.env.ZEFF_DEV_ORIGINS
      ? {
          allowedDevOrigins: [...process.env.ZEFF_DEV_ORIGINS.split(","), "127.0.0.1", "**.ts.net"],
        }
      : {}),
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
    // Pages that moved: plain HTTP redirects (src/lib/moved-pages.ts — the proxy does the same under an account's prefix).
    redirects() {
      return Promise.resolve(MOVED_PAGES);
    },
    experimental: {
      // Context items upload files (screenshots, documents) with their form — up to 20 MB each.
      serverActions: { bodySizeLimit: "50mb" },
    },
  };

  return nextConfig;
};

const config = (phase: string): NextConfig => configFor(hooksFor(phase));
export default config;
