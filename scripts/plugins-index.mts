import fs from "node:fs";
import path from "node:path";
import { pluginsDir, renderActions, renderLlmTasks, renderManifests, renderServer } from "../src/lib/plugins/index-gen";

/**
 * Writes src/plugins/index.generated.ts (one import per src/plugins/<id>/plugin.ts) and
 * server.generated.ts (one per <id>/server.ts, for what a plugin registers on the server) and
 * actions.generated.ts (every `export const <NAME>_ACTIONS` list in a plugin's files). A plugin is
 * added by creating its folder and running this (`npm run plugins:index`); tests/plugin-index.test.ts
 * fails while they are stale. `--check` only compares. A file is written only when it differs.
 *
 * Generated files, one policy: these (src/plugins/*.generated.ts) are COMMITTED — they follow only from the repo's own
 * folders, the same in every checkout, so tsc, the editor and a fresh clone work without a script run first. The
 * integrations' (src/lib/integrations/mounted-*.ts, scripts/integrations.mjs) are IGNORED — they follow from what is
 * mounted under integrations/ on this machine. Both are written again before dev, build, test and typecheck (the pre*
 * scripts), and `npm run check:generated` fails when either is out of date.
 */
if (process.argv[1]?.endsWith("plugins-index.mts")) {
  const dir = pluginsDir();
  const outputs: [string, string][] = [
    [path.join(dir, "index.generated.ts"), renderManifests()],
    [path.join(dir, "server.generated.ts"), renderServer()],
    [path.join(dir, "actions.generated.ts"), renderActions()],
    [path.join(dir, "llm-tasks.generated.ts"), renderLlmTasks()],
  ];
  let stale = false;
  for (const [file, next] of outputs) {
    if (process.argv.includes("--check")) {
      const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
      if (cur !== next) {
        console.error(`${path.relative(process.cwd(), file)} is stale — run \`npm run plugins:index\`.`);
        stale = true;
      }
    } else {
      const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
      if (cur === next) continue;
      fs.writeFileSync(file, next);
      console.log("wrote", path.relative(process.cwd(), file));
    }
  }
  if (stale) process.exit(1);
  if (process.argv.includes("--check")) console.log("plugins: the generated indexes are up to date");
}
