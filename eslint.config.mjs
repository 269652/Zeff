import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local data (SQLite DB, the Roar Chrome profile's cached web assets, etc.).
    "data/**",
    // npm run deploy's build before the swap and the build before that (scripts/swap-dist.mjs).
    ".next-build/**",
    ".next-old/**",
    // The knowledge server: its own app (knowledge/), linted with its own config.
    "knowledge/.next/**",
    "knowledge/.next-build/**",
    "knowledge/.next-old/**",
    "knowledge/data/**",
    // The bundle (scripts/dist.mjs) and the launcher's Electron.
    "dist/**",
    "launcher/node_modules/**",
  ]),
  // The launcher (launcher/) is plain CommonJS for Electron.
  { files: ["launcher/**/*.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
]);

export default eslintConfig;
