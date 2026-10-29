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
    // Local data (SQLite DB, the Chrono Chrome profile's cached web assets, etc.).
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
  // Accessibility (WCAG 2.2 AA): the jsx-a11y rules that don't misfire on this code base, as errors. (Not
  // label-has-associated-control — it misses controls nested in spans — nor the click-handler rules, which flag
  // drop zones and stopPropagation wrappers; those are checked in the browser with axe instead.)
  {
    files: ["**/*.tsx"],
    rules: Object.fromEntries(
      [
        "alt-text", "anchor-has-content", "anchor-is-valid", "aria-activedescendant-has-tabindex", "aria-props",
        "aria-proptypes", "aria-role", "aria-unsupported-elements", "autocomplete-valid", "heading-has-content",
        "html-has-lang", "iframe-has-title", "img-redundant-alt", "interactive-supports-focus", "no-access-key",
        "no-distracting-elements", "no-interactive-element-to-noninteractive-role", "no-redundant-roles",
        "role-has-required-aria-props", "role-supports-aria-props", "scope", "tabindex-no-positive",
      ].map((r) => [`jsx-a11y/${r}`, "error"]),
    ),
  },
  // The launcher (launcher/) is plain CommonJS for Electron.
  { files: ["launcher/**/*.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
]);

export default eslintConfig;
