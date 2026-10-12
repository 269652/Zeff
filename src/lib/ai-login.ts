import { spawn, execFile } from "node:child_process";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { findCodexCli } from "@/plugins/codex-cli/cli";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import type { AiProvider } from "@/lib/ai/shared";

/**
 * Signing the AI CLIs in from the setup: each has a `login` command that opens the browser for its OAuth
 * (ChatGPT, Claude, GitHub) and ends when the sign-in is through. Zeff starts it, shows the address when
 * the browser didn't open by itself, and asks the CLI whether it is signed in (Copilot has no such
 * question: its login ending well is the answer). Zeff never sees a password. Server only.
 */
export type Cmd = { command: string; args: string[] };
type Where = { login: Cmd; status: Cmd | null };

/** The CLI's login (and status) commands, or null when it isn't installed. */
export function loginCommands(provider: AiProvider): Where | null {
  if (provider === "claude") {
    const c = findClaudeCli();
    return c ? { login: { command: c, args: ["auth", "login"] }, status: { command: c, args: ["auth", "status"] } } : null;
  }
  if (provider === "codex") {
    const c = findCodexCli();
    return c ? { login: { command: c.command, args: [...c.args, "login"] }, status: { command: c.command, args: [...c.args, "login", "status"] } } : null;
  }
  const c = findCopilotCli();
  return c ? { login: { command: c.command, args: [...c.args, "login"] }, status: null } : null;
}

export type LoginState = { provider: AiProvider; state: "running" | "done" | "failed"; url: string | null; out: string };

const g = globalThis as { __zeffAiLogins?: Map<AiProvider, LoginState> };
const logins = (g.__zeffAiLogins ??= new Map());
export const loginStates = (): LoginState[] => [...logins.values()];

/** The first web address in a text (what a login prints when the browser doesn't open). */
export const urlIn = (text: string): string | null => text.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;

export type LoginDeps = { commands?: Where | null; spawnLogin?: (c: Cmd, onOut: (s: string) => void) => Promise<number>; timeoutMs?: number };

const defaultSpawn = (c: Cmd, onOut: (s: string) => void, timeoutMs = 10 * 60000) =>
  new Promise<number>((resolve) => {
    const child = spawn(c.command, c.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => onOut(String(d)));
    child.stderr.on("data", (d) => onOut(String(d)));
    child.on("error", (e) => (onOut(String(e)), clearTimeout(timer), resolve(-1)));
    child.on("close", (code) => (clearTimeout(timer), resolve(code ?? -1)));
  });

/** Starts the provider's login in the background (once at a time per provider); returns at once. */
export function startAiLogin(provider: AiProvider, deps: LoginDeps = {}): LoginState {
  const running = logins.get(provider);
  if (running?.state === "running") return running;
  const cmds = deps.commands === undefined ? loginCommands(provider) : deps.commands;
  if (!cmds) {
    const s: LoginState = { provider, state: "failed", url: null, out: "Not installed." };
    logins.set(provider, s);
    return s;
  }
  const s: LoginState = { provider, state: "running", url: null, out: "" };
  logins.set(provider, s);
  const onOut = (chunk: string) => {
    const cur = logins.get(provider)!;
    const out = `${cur.out}${chunk}`.slice(-600);
    logins.set(provider, { ...cur, out, url: cur.url ?? urlIn(out) });
  };
  void (deps.spawnLogin ?? ((c, o) => defaultSpawn(c, o, deps.timeoutMs)))(cmds.login, onOut).then((code) => {
    const cur = logins.get(provider)!;
    logins.set(provider, { ...cur, state: code === 0 ? "done" : "failed", out: code === 0 ? "" : cur.out.replace(/\s+/g, " ").trim().slice(-200) || `Exit code ${code}.` });
  });
  return s;
}

/** Whether the CLI says it is signed in: true / false, null when it can't be asked (Copilot, or not installed). */
export function aiSignedIn(provider: AiProvider, commands: Where | null = loginCommands(provider)): Promise<boolean | null> {
  const st = commands?.status;
  if (!st) return Promise.resolve(null);
  return new Promise((resolve) =>
    execFile(st.command, st.args, { timeout: 20000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      // Claude answers JSON with loggedIn; Codex's exit code says it.
      try {
        const j = JSON.parse(String(stdout)) as { loggedIn?: boolean };
        if (typeof j.loggedIn === "boolean") return resolve(j.loggedIn);
      } catch {
        // not JSON
      }
      resolve(!/not logged in|not signed in/i.test(String(stdout)));
    }),
  );
}
