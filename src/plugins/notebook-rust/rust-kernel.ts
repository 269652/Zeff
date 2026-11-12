import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { Bridge, CellStatus, Kernel } from "@/plugins/notebook/kernel";
import type { SharedAccess } from "@/plugins/notebook/shared-storage";
import { versionOf, type KernelContext, type KernelLanguage, type Spawned } from "@/plugins/notebook/languages";
import { RUST_PRELUDE } from "./prelude";
import type { KernelMsg } from "@/plugins/notebook/outputs";
import { mergeItems, rustErrors, rustProgram, splitRust } from "./rust";

/**
 * Rust without a REPL: each cell is a program — compiled by rustc, then run (both where the session lives: in the container or on
 * this computer). What a cell defines as items stays for the cells after it once it compiled (rust.ts).
 */
class RustKernel implements Kernel {
  private items: string[] = [];
  private n = 0;
  private current: Spawned | null = null;
  private stopped = false;

  constructor(private ctx: KernelContext) {}

  alive() {
    return true;
  }

  private run(argv: string[], onOut: (name: "stdout" | "stderr", text: string) => void): Promise<number> {
    return new Promise((resolve) => {
      const p = this.ctx.spawn(argv);
      this.current = p;
      p.child.stdout!.setEncoding("utf8").on("data", (c: string) => onOut("stdout", c));
      p.child.stderr!.setEncoding("utf8").on("data", (c: string) => onOut("stderr", c));
      p.child.on("error", (e) => (onOut("stderr", `${e.message}\n`), resolve(-1)));
      p.child.on("close", (code) => resolve(code ?? -1));
    });
  }

  /** What the cell takes in, as files its `input("Name")` reads (the same folder in a container: /work). */
  private writeInputs(inputs: Record<string, unknown>): void {
    const dir = path.join(this.ctx.dir, "_inputs");
    fs.rmSync(dir, { recursive: true, force: true });
    if (!Object.keys(inputs).length) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, value] of Object.entries(inputs)) fs.writeFileSync(path.join(dir, `${name.replace(/[^\p{L}\p{N}]/gu, "_")}.json`), JSON.stringify(value));
  }

  /** The shared storage as files for the program (`shared_get(key)` …): one per key, named by the key's bytes in hex. */
  private writeShared(snapshot: Record<string, string>): void {
    const dir = path.join(this.ctx.dir, "_shared");
    fs.rmSync(dir, { recursive: true, force: true });
    if (!Object.keys(snapshot).length) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(snapshot)) fs.writeFileSync(path.join(dir, `${Buffer.from(k, "utf8").toString("hex")}.txt`), v);
  }

  /** What the program changed in the shared storage, handed on (a new or different file: set; a missing one: removed). */
  private readSharedBack(snapshot: Record<string, string>, shared?: SharedAccess): void {
    if (!shared) return;
    const dir = path.join(this.ctx.dir, "_shared");
    const now = new Map<string, string>();
    try {
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (f.endsWith(".txt")) now.set(Buffer.from(f.slice(0, -4), "hex").toString("utf8"), fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      return;
    }
    for (const [k, v] of now) if (snapshot[k] !== v) shared.apply("set", k, v);
    for (const k of Object.keys(snapshot)) if (!now.has(k)) shared.apply("remove", k);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  async execute(_id: string, code: string, onMsg: (m: KernelMsg) => void, _bridge?: Bridge, inputs: Record<string, unknown> = {}, shared?: SharedAccess): Promise<CellStatus> {
    this.stopped = false;
    this.writeInputs(inputs);
    const snapshot = shared?.snapshot ?? {};
    this.writeShared(snapshot);
    const returnFile = path.join(this.ctx.dir, "_return.json");
    fs.rmSync(returnFile, { force: true });
    const cell = splitRust(code);
    const program = rustProgram(cell, this.items);
    const stem = `cell_${++this.n}`;
    const exeName = process.platform === "win32" && this.ctx.where === "host" ? `${stem}.exe` : stem;
    const files = [path.join(this.ctx.dir, `${stem}.rs`), path.join(this.ctx.dir, exeName), path.join(this.ctx.dir, `${stem}.pdb`)];
    fs.writeFileSync(files[0], program.source);
    let errText = "";
    const rc = await this.run([...this.ctx.program, "--edition", "2021", "-C", "opt-level=0", "--color", "never", "-o", this.ctx.path(exeName), this.ctx.path(`${stem}.rs`)], (_n, t) => (errText += t));
    if (this.stopped) return "aborted";
    if (rc !== 0) {
      const lines = rustErrors(errText, program.bodyLine);
      onMsg({ t: "error", ename: "CompileError", evalue: lines.find((l) => l.startsWith("error")) ?? "The cell did not compile.", traceback: lines });
      return "error";
    }
    // (It compiled: its items stay for the cells after it.)
    this.items = mergeItems(this.items, cell.items);
    const code2 = await this.run([this.ctx.path(exeName)], (name, text) => onMsg({ t: "stream", name, text }));
    for (const f of files) fs.rm(f, { force: true }, () => undefined);
    this.readSharedBack(snapshot, shared);
    if (this.stopped) return "aborted";
    // Its output: the last expression (or zeff_return!) written as JSON by the program.
    try {
      if (fs.existsSync(returnFile)) {
        onMsg({ t: "returned", value: JSON.parse(fs.readFileSync(returnFile, "utf8")) as unknown });
        fs.rmSync(returnFile, { force: true });
      }
    } catch {
      // (not JSON: nothing handed on)
    }
    if (code2 !== 0) {
      onMsg({ t: "error", ename: "ExitCode", evalue: `The program ended with code ${code2}.`, traceback: [] });
      return "error";
    }
    return "ok";
  }

  async request(op: "vars" | "complete"): Promise<Record<string, unknown>> {
    if (op === "vars") return { items: this.items.map((it) => ({ name: it.split(/[({<\s]/).filter(Boolean).slice(0, 2).join(" "), type: "item", preview: it.length > 120 ? `${it.slice(0, 120)}…` : it })) };
    return { from: 0, to: 0, items: [] };
  }

  interrupt() {
    this.stopped = true;
    this.current?.kill();
  }

  kill() {
    this.interrupt();
  }
}

const probe = (cmd: string, args: string[]): Promise<string | null> => new Promise((resolve) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out, errOut) => resolve(err ? null : `${out}${errOut}`.trim())));

/** Rust: cells compiled by rustc in a container of rust:1-slim, or by this computer's rustc. */
export const rust: KernelLanguage = {
  id: "rust",
  label: "Rust",
  monaco: "rust",
  extension: "rs",
  version: versionOf(RUST_PRELUDE),
  docker: { image: "rust:1-slim", program: ["rustc"] },
  async probe() {
    const v = /rustc\s+(\d+\.\d+[\w.-]*)/i.exec((await probe("rustc", ["--version"])) ?? "");
    return v ? { program: ["rustc"], version: v[1] } : null;
  },
  async start(ctx) {
    return new RustKernel(ctx);
  },
};
