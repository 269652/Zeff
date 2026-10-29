#!/usr/bin/env node
/**
 * The e2e smoke suite (e2e/*.e2e.mjs — node:test + playwright-core, headless Chrome): the core UI flows of the Workspace
 * (a page that keeps its text, the slash menu, inline formulas, page tables, forms over a database's rows, a person widget's
 * suggestions).
 *
 *   npm run e2e                         starts a disposable test server (scripts/test-server.mjs), seeds it (e2e/seed.mts),
 *                                       runs the suite, stops the server
 *   npm run e2e -- --url http://localhost:9450   against a running test server (seeded first if it isn't yet)
 *   npm run e2e -- --keep               leave the started server running (its URL is printed; it stops at its TTL)
 *   npm run e2e -- --only forms         only the files whose name contains "forms"
 *
 * A failing test leaves a screenshot in e2e/artifacts/. Never point --url at the live Zeff (9333): it is refused.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readRegistry } from "../scripts/test-servers-lib.mjs";
import { runSeed, startTestServer, stopTestServer, testEnv } from "../scripts/test-server.mjs";

const HERE = import.meta.dirname;
const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SEED = "e2e/seed.mts";

/** The pages the suite opens, compiled before the first test (a cold `next dev` takes minutes for the first one). */
async function warm(url, seed) {
  for (const route of ["/workspace", `/workspace/${seed.dbId}`]) {
    const t = Date.now();
    const r = await fetch(url + route, { signal: AbortSignal.timeout(10 * 60_000) });
    console.error(`  warmed ${route}: ${r.status} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
}

async function main() {
  let server = null;
  let url = val("--url")?.replace(/\/+$/, "");
  let seedFile;
  if (url) {
    const port = Number(new URL(url).port);
    if (port === 9333) throw new Error("9333 is the live Zeff — the suite writes pages and rows: run it against a test server.");
    const e = readRegistry().find((x) => x.port === port);
    if (!e) throw new Error(`No registered test server on port ${port} (start one with npm run test:server).`);
    seedFile = path.join(e.dataDir, "e2e-seed.json");
    if (!fs.existsSync(seedFile)) console.error(runSeed(SEED, testEnv(e.dataDir, e.distDir)));
  } else {
    server = await startTestServer({ seeds: [SEED], ttlMs: Number(val("--ttl") ?? 30) * 60_000 });
    url = server.url;
    seedFile = path.join(server.dataDir, "e2e-seed.json");
  }
  const started = Date.now();
  let code = 1;
  try {
    await warm(url, JSON.parse(fs.readFileSync(seedFile, "utf8")));
    const only = val("--only");
    const files = fs
      .readdirSync(HERE)
      .filter((f) => f.endsWith(".e2e.mjs") && (!only || f.includes(only)))
      .map((f) => path.join(HERE, f));
    if (!files.length) throw new Error(`No e2e files${only ? ` matching "${only}"` : ""}.`);
    fs.rmSync(path.join(HERE, "artifacts"), { recursive: true, force: true });
    code = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files], {
        stdio: "inherit",
        env: { ...process.env, ZEFF_E2E_URL: url, ZEFF_E2E_SEED: seedFile },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
    console.error(`e2e: ${code === 0 ? "passed" : "FAILED"} in ${((Date.now() - started) / 1000).toFixed(0)} s${code === 0 ? "" : ` — screenshots in ${path.join(HERE, "artifacts")}`}`);
  } finally {
    if (server && !argv.includes("--keep")) {
      await stopTestServer(server.pid).catch((e) => console.error(`Stopping the test server failed: ${e.message}`));
      console.error(`Stopped the test server (pid ${server.pid}).`);
    } else if (server) console.error(`The test server stays: ${server.url} (npm run test:server -- --stop ${server.port}).`);
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
