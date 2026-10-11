import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TOKEN = "t0ken";
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
const until = async (ok: () => boolean, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("timed out");
};

/** A fake Zeff: records /api/work/exit calls; answers 503 while `down`. */
function fakeZeff(port: number) {
  const calls: { runId: number; account: string; token: string | undefined }[] = [];
  const state = { down: false };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (state.down) return void res.writeHead(503).end();
      calls.push({ ...JSON.parse(body), token: req.headers["x-zeff-work-token"] as string | undefined });
      res.writeHead(200).end("{}");
    });
  });
  return new Promise<{ calls: typeof calls; state: typeof state; server: http.Server }>((resolve) => server.listen(port, "127.0.0.1", () => resolve({ calls, state, server })));
}

async function startHost(zeffPort: number, dir: string): Promise<{ proc: ChildProcess; url: string; port: number }> {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.resolve("scripts/work-host.mjs")], {
    env: { ...process.env, ZEFF_WORK_PORT: String(port), ZEFF_URL: `http://127.0.0.1:${zeffPort}`, ZEFF_WORK_TOKEN: TOKEN, ZEFF_WORK_STATE: path.join(dir, "state.json") },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/health`, { headers: { "x-zeff-work-token": TOKEN } })).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return { proc, url, port };
}

const post = (url: string, body: unknown, token = TOKEN) =>
  fetch(`${url}/spawn`, { method: "POST", headers: { "content-type": "application/json", "x-zeff-work-token": token }, body: JSON.stringify(body) });

test("the work host starts a worker, writes its output, and reports its end to Zeff — also when Zeff is down meanwhile", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-host-"));
  const zeffPort = await freePort();
  const zeff = await fakeZeff(zeffPort);
  const host = await startHost(zeffPort, dir);
  try {
    // Without the token, or from a browser page: refused.
    assert.equal((await post(host.url, {}, "wrong")).status, 403);
    assert.equal((await fetch(`${host.url}/health`, { headers: { "x-zeff-work-token": TOKEN, origin: "https://evil.example" } })).status, 403);

    const outFile = path.join(dir, "1.log");
    const errFile = path.join(dir, "1.err");
    const spec = (runId: number, code: string) => ({ runId, account: "default", command: process.execPath, args: ["-e", code], cwd: dir, env: process.env, stdin: "hello", outFile: path.join(dir, `${runId}.log`), errFile: path.join(dir, `${runId}.err`) });
    const r = await post(host.url, spec(1, "process.stdin.on('data',d=>console.log('got '+d))"));
    assert.equal(r.status, 200);
    const { pid } = (await r.json()) as { pid: number };
    assert.ok(pid > 0);
    await until(() => zeff.calls.length === 1);
    assert.deepEqual(zeff.calls[0], { runId: 1, account: "default", token: TOKEN });
    assert.match(fs.readFileSync(outFile, "utf8"), /got hello/);
    assert.equal(fs.existsSync(errFile), true);

    // Zeff restarting (a deploy) when the worker ends: reported once it's back.
    zeff.state.down = true;
    assert.equal((await post(host.url, spec(2, "setTimeout(()=>{},300)"))).status, 200);
    await new Promise((r) => setTimeout(r, 1800));
    assert.equal(zeff.calls.length, 1);
    zeff.state.down = false;
    await until(() => zeff.calls.length === 2);
    assert.equal(zeff.calls[1].runId, 2);

    // The same run twice: refused while it's known.
    zeff.state.down = true;
    assert.equal((await post(host.url, spec(3, "0"))).status, 200);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await post(host.url, spec(3, "0"))).status, 400);
    zeff.state.down = false;
  } finally {
    host.proc.kill();
    zeff.server.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); // (a killed host lets go of it a moment later)
  }
});

test("a host restarted meanwhile reports the end of a worker it started before", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-host-"));
  const zeffPort = await freePort();
  const zeff = await fakeZeff(zeffPort);
  let host = await startHost(zeffPort, dir);
  try {
    const body = { runId: 7, account: "default", command: process.execPath, args: ["-e", "setTimeout(()=>{},2500)"], cwd: dir, env: process.env, stdin: "", outFile: path.join(dir, "7.log"), errFile: path.join(dir, "7.err") };
    assert.equal((await post(host.url, body)).status, 200);
    host.proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    host = await startHost(zeffPort, dir);
    await until(() => zeff.calls.some((c) => c.runId === 7), 20000);
  } finally {
    host.proc.kill();
    zeff.server.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); // (a killed host lets go of it a moment later)
  }
});

test("Zeff's exit route takes only the work host's token", async () => {
  process.env.ZEFF_WORK_TOKEN = TOKEN;
  const { fromWorkHost } = await import("@/lib/work/host");
  const req = (t?: string) => new Request("http://127.0.0.1/api/work/exit", { method: "POST", headers: t === undefined ? {} : { "x-zeff-work-token": t } });
  assert.equal(fromWorkHost(req(TOKEN)), true);
  assert.equal(fromWorkHost(req("nope!")), false);
  assert.equal(fromWorkHost(req()), false);
  process.env.ZEFF_WORK_TOKEN = "";
  assert.equal(fromWorkHost(req("")), false); // no token configured: nobody
});

/** A stand-in for the Claude CLI in stream-json mode: one answer (assistant + result) per message, quits when stdin ends. */
const FAKE_CLI = [
  "const rl = require('node:readline').createInterface({ input: process.stdin });",
  "const out = (o) => console.log(JSON.stringify(o));",
  "let n = 0;",
  "rl.on('line', (l) => { const m = JSON.parse(l); n++; out({ type: 'user', isReplay: true, message: { role: 'user', content: m.message.content } });",
  "  setTimeout(() => { out({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok ' + m.message.content }] } }); out({ type: 'result', subtype: 'success', num_turns: n }); }, 300); });",
  "rl.on('close', () => { out({ type: 'bye', n }); });",
].join("\n");

test("a live run takes messages while it works, and the host ends its stdin once it is idle", async () => {
  process.env.ZEFF_WORK_IDLE_MS = "500";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-work-host-"));
  const zeffPort = await freePort();
  const zeff = await fakeZeff(zeffPort);
  const host = await startHost(zeffPort, dir);
  delete process.env.ZEFF_WORK_IDLE_MS;
  try {
    const outFile = path.join(dir, "9.log");
    const spec = { runId: 9, account: "default", command: process.execPath, args: ["-e", FAKE_CLI], cwd: dir, env: process.env, stdin: "first", outFile, errFile: path.join(dir, "9.err"), live: true };
    assert.equal((await post(host.url, spec)).status, 200);
    const msg = (text: string, runId = 9) => fetch(`${host.url}/message`, { method: "POST", headers: { "content-type": "application/json", "x-zeff-work-token": TOKEN }, body: JSON.stringify({ runId, text }) });
    // While it is still answering the first message.
    assert.equal((await msg("second")).status, 200);
    await until(() => zeff.calls.some((c) => c.runId === 9)); // idle -> stdin closed -> the CLI quit -> reported
    const lines = fs.readFileSync(outFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.filter((l) => l.type === "user").map((l) => l.message.content), ["first", "second"]);
    assert.equal(lines.filter((l) => l.type === "result").length, 2);
    assert.equal(lines.at(-1).type, "bye");
    // Over: no more messages (the caller starts a new run), unknown runs too.
    assert.equal((await msg("late")).status, 409);
    assert.equal((await msg("x", 12345)).status, 409);
  } finally {
    host.proc.kill();
    zeff.server.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); // (a killed host lets go of it a moment later)
  }
});
