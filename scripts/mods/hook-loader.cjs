/* eslint-disable @typescript-eslint/no-require-imports -- a build loader (and what it uses) is CommonJS: Turbopack loads webpack loaders with require() */
/**
 * The build loader that puts the mods' hooks in (next.config.ts, turbopack.rules): every exported function and component of a file
 * below src/ behind a named hook (analyze.cjs: transform). The source stays as it is — this changes only what is built. A file it can't
 * read the way it expects is passed through unchanged: a hook less is never a broken build.
 */
const path = require("node:path");
const { transform } = require("./analyze.cjs");

module.exports = function zeffHookLoader(source) {
  const file = this.resourcePath.split(path.sep).join("/");
  const at = file.lastIndexOf("/src/");
  if (at < 0) return source;
  try {
    return transform(file.slice(at + 5), String(source));
  } catch (e) {
    // (said once per file in the build's log; the file is built as it is)
    console.warn(`[mods] no hooks for ${file.slice(at + 5)}: ${e && e.message}`);
    return source;
  }
};
