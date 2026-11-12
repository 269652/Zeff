import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KernelContext, Spawned } from "./languages";
import type { KernelMsg } from "./outputs";
import type { SharedAccess } from "./shared-storage";

/**
 * A kernel: a session of one language that runs cells one after the other and keeps what they made. The language plugins bring
 * the programs; this is the part they share — the kernel that talks to a REPL program over stdin / stdout (HarnessKernel).
 * Where the program runs (a container, this computer) is the context's business (runner.ts). Server only.
 */

export type CellStatus = "ok" | "error" | "aborted";

/** What a cell's code may ask of Zeff (zeff.table(…), zeff.metric(…)): a request, and an answer or why not. The permission layer is behind it (sessions.ts). */
export type Bridge = (req: { op: string; args: Record<string, unknown> }) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;

export interface Kernel {
  alive(): boolean;
  execute(id: string, code: string, onMsg: (m: KernelMsg) => void, bridge?: Bridge, inputs?: Record<string, unknown>, shared?: SharedAccess): Promise<CellStatus>;
  /** What the session knows: its variables, the completions at a place in a cell. */
  request(op: "vars" | "complete", args?: { code?: string; pos?: number }): Promise<Record<string, unknown>>;
  /** Stop the running cell (Python: the cell only, the session stays; the others: the session ends). */
  interrupt(): void;
  kill(): void;
}

/**
 * A REPL program that answers in lines of JSON after a marker (the harnesses of the language plugins): it is written to the
 * session's folder, started where the session lives, and talked to.
 */
export class HarnessKernel implements Kernel {
  private buf = "";
  private running: { id: string; onMsg: (m: KernelMsg) => void; done: (s: CellStatus) => void; bridge?: Bridge } | null = null;
  private asked = new Map<string, (m: Record<string, unknown>) => void>();
  private seq = 0;
  private ready!: Promise<void>;
  private dead = false;
  /** Where the shared storage goes (the last cell's: its writes may come a moment after it ended). */
  private shared: SharedAccess | null = null;

  private constructor(
    private proc: Spawned,
    private mark: string,
    private softInterrupt: boolean,
  ) {}

  /** `file`: the harness written into the folder; `args`: how the interpreter is called with it (the file as the process sees it); `soft`: a cell can be interrupted without ending the session. */
  static async start(ctx: KernelContext, opts: { file: string; source: string; args: (path: string) => string[]; soft: boolean; readyMs?: number }): Promise<HarnessKernel> {
    const mark = crypto.randomBytes(12).toString("hex");
    fs.mkdirSync(ctx.dir, { recursive: true });
    fs.writeFileSync(path.join(ctx.dir, opts.file), opts.source);
    const proc = ctx.spawn([...ctx.program, ...opts.args(ctx.path(opts.file))], { env: { ZNB_MARK: mark }, stdin: true });
    const k = new HarnessKernel(proc, mark, opts.soft);
    k.wire(opts.readyMs ?? (ctx.where === "docker" ? 60_000 : 20_000));
    await k.ready;
    return k;
  }

  private wire(readyMs: number) {
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    this.ready = new Promise((res, rej) => ((resolveReady = res), (rejectReady = rej)));
    const timer = setTimeout(() => rejectReady(new Error("The session did not start in time.")), readyMs);
    const child = this.proc.child;
    let early = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        if (line.startsWith(this.mark)) {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line.slice(this.mark.length)) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (msg.t === "ready") {
            clearTimeout(timer);
            resolveReady();
          } else this.dispatch(msg);
        } else if (this.running) this.running.onMsg({ t: "stream", name: "stdout", text: `${line}\n` });
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      early = (early + chunk).slice(-600);
      this.running?.onMsg({ t: "stream", name: "stderr", text: chunk });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectReady(e);
    });
    child.on("exit", () => {
      this.dead = true;
      clearTimeout(timer);
      rejectReady(new Error(`The session ended before it was ready.${early.trim() ? ` ${early.trim()}` : ""}`));
      const r = this.running;
      this.running = null;
      if (r) {
        r.onMsg({ t: "error", ename: "KernelDied", evalue: "The session ended (stopped, or it crashed). Its variables are gone.", traceback: [] });
        r.done("error");
      }
      for (const [, f] of this.asked) f({});
      this.asked.clear();
    });
  }

  private dispatch(msg: Record<string, unknown>) {
    const id = String(msg.id ?? "");
    if (msg.t === "storage") {
      // The code wrote to (or cleared) the shared storage: kept for the page, so the other kernels see it.
      this.shared?.apply(String(msg.op ?? ""), String(msg.key ?? ""), typeof msg.value === "string" ? msg.value : undefined);
      return;
    }
    if (msg.t === "zeff") {
      // The code asks Zeff for something: answered through the bridge (which may ask the user first), the answer written back.
      const rid = String(msg.rid ?? "");
      const reply = (res: { ok: boolean; value?: unknown; error?: string }) => this.proc.child.stdin?.write(`${JSON.stringify({ op: "reply", rid, ...res })}\n`);
      const bridge = this.running?.bridge;
      if (!bridge) return void reply({ ok: false, error: "Zeff is not available here." });
      bridge({ op: String(msg.op ?? ""), args: msg.args && typeof msg.args === "object" ? (msg.args as Record<string, unknown>) : {} }).then(reply, (e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (msg.t === "vars" || msg.t === "complete") {
      this.asked.get(id)?.(msg);
      this.asked.delete(id);
      return;
    }
    const r = this.running;
    if (!r || r.id !== id) return;
    if (msg.t === "done") {
      this.running = null;
      r.done((msg.status as CellStatus) ?? "ok");
    } else r.onMsg(msg as KernelMsg);
  }

  alive() {
    return !this.dead && this.proc.child.exitCode === null;
  }

  execute(id: string, code: string, onMsg: (m: KernelMsg) => void, bridge?: Bridge, inputs?: Record<string, unknown>, shared?: SharedAccess): Promise<CellStatus> {
    return new Promise((done) => {
      if (!this.alive()) {
        onMsg({ t: "error", ename: "KernelDied", evalue: "The session is not running.", traceback: [] });
        return done("error");
      }
      this.shared = shared ?? null;
      this.running = { id, onMsg, done, bridge };
      this.proc.child.stdin!.write(`${JSON.stringify({ op: "execute", id, code, inputs: inputs ?? {}, shared: shared?.snapshot ?? {} })}\n`);
    });
  }

  request(op: "vars" | "complete", args: { code?: string; pos?: number } = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      if (!this.alive()) return resolve({});
      const id = `q${++this.seq}`;
      const timer = setTimeout(() => (this.asked.delete(id), resolve({})), 5000);
      this.asked.set(id, (m) => (clearTimeout(timer), resolve(m)));
      this.proc.child.stdin!.write(`${JSON.stringify({ op, id, ...args })}\n`);
    });
  }

  interrupt() {
    if (this.softInterrupt) this.proc.child.stdin!.write(`${JSON.stringify({ op: "interrupt" })}\n`);
    else this.kill();
  }

  kill() {
    this.proc.kill();
  }
}
