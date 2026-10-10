import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    return [{ source: "/boards", destination: "/todos", permanent: false }];
  },
  experimental: {
    // Context items upload files (screenshots, documents) with their form — up to 20 MB each.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
