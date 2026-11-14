import fs from "node:fs";
import path from "node:path";
import { loadMods } from "./server";
import { currentAccountId } from "@/db/accounts";
import { listMods, safeMode } from "./store";

/**
 * What a page brings of the mods (the root layout puts it into <head>): the browser parts of the mods that are on — run as the HTML is
 * read, before React starts, so their hooks are there for the first render (the server rendered with them too: both draw the same) —
 * and their stylesheets. Nothing in safe mode. Server only.
 */
export function modsForPage(): { script: string; css: string } {
  try {
    loadMods();
    if (safeMode()) return { script: "", css: "" };
    let script = "";
    let css = "";
    const account = currentAccountId();
    for (const m of listMods()) {
      if (!m.state.enabled) continue;
      // (A mod for some accounts: only in their pages.)
      if (m.state.accounts?.length && !m.state.accounts.includes(account)) continue;
      const js = path.join(m.dir, ".build", "client.js");
      const st = path.join(m.dir, ".build", "style.css");
      if (fs.existsSync(js)) script += fs.readFileSync(/*turbopackIgnore: true*/ js, "utf8") + "\n";
      if (fs.existsSync(st)) css += `/* mod ${m.manifest.id} */\n` + fs.readFileSync(/*turbopackIgnore: true*/ st, "utf8") + "\n";
    }
    // (In the HTML: a </script> or </style> inside would end the tag.)
    return { script: script.replace(/<\/script/gi, "<\\/script"), css: css.replace(/<\/style/gi, "<\\/style") };
  } catch (e) {
    console.warn("[mods] not loaded for this page:", e);
    return { script: "", css: "" };
  }
}
