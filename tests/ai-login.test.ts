import assert from "node:assert/strict";
import test from "node:test";
import { loginStates, startAiLogin, urlIn } from "@/lib/ai-login";

const cmds = { login: { command: "x", args: ["login"] }, status: null };
const tick = () => new Promise((r) => setTimeout(r, 5));

test("the login runs in the background; when it ends well it is done, the address it printed is kept for a browser that didn't open", async () => {
  let finish!: (code: number) => void;
  const s = startAiLogin("codex", {
    commands: cmds,
    spawnLogin: (_c, onOut) => new Promise<number>((r) => ((finish = r), onOut("Open https://auth.openai.com/oauth/authorize?x=1 to sign in\n"))),
  });
  assert.equal(s.state, "running");
  assert.equal(startAiLogin("codex", { commands: cmds, spawnLogin: async () => 0 }).state, "running", "not started twice");
  assert.equal(loginStates().find((x) => x.provider === "codex")!.url, "https://auth.openai.com/oauth/authorize?x=1");
  finish(0);
  await tick();
  assert.equal(loginStates().find((x) => x.provider === "codex")!.state, "done");
});

test("a failing login says what it printed; a CLI that isn't installed says so", async () => {
  startAiLogin("claude", { commands: cmds, spawnLogin: async (_c, o) => (o("login   cancelled\n"), 1) });
  await tick();
  const f = loginStates().find((x) => x.provider === "claude")!;
  assert.equal(f.state, "failed");
  assert.match(f.out, /login cancelled/);
  assert.equal(startAiLogin("copilot", { commands: null }).out, "Not installed.");
  assert.equal(urlIn("no address"), null);
});
