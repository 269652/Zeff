import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `data/` holds only local runtime state (the SQLite DB + WAL, and the Roar
  // Chrome profile). None of it is a build dependency, and some files are held
  // open by another process (the dev server has the DB open; a running Roar
  // Chrome exclusively locks its `Cookies`), which makes output file tracing
  // fail with "os error 32 (file in use)". Keep the whole folder out of the trace.
  outputFileTracingExcludes: {
    "/": ["data/**", "data/**/*"],
    "/**": ["data/**", "data/**/*"],
  },
};

export default nextConfig;
