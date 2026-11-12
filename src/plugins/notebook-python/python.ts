import { execFile } from "node:child_process";
import { HarnessKernel } from "@/plugins/notebook/kernel";
import { versionOf, type KernelLanguage } from "@/plugins/notebook/languages";
import { PYTHON_HARNESS } from "./harness";

const probe = (cmd: string, args: string[]): Promise<string | null> => new Promise((resolve) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out, errOut) => resolve(err ? null : `${out}${errOut}`.trim())));

/** Python: a REPL program (harness.ts) in a container of python:3.12-slim, or on this computer. */
export const python: KernelLanguage = {
  id: "python",
  label: "Python",
  monaco: "python",
  extension: "py",
  version: versionOf(PYTHON_HARNESS),
  docker: { image: "python:3.12-slim", program: ["python"] },
  async probe() {
    for (const program of [["python"], ["python3"], ["py", "-3"]]) {
      const v = /Python\s+(\d+\.\d+[\w.]*)/i.exec((await probe(program[0], [...program.slice(1), "--version"])) ?? "");
      if (v) return { program, version: v[1] };
    }
    return null;
  },
  start: (ctx) => HarnessKernel.start(ctx, { file: "_zeff_kernel.py", source: PYTHON_HARNESS, args: (p) => ["-u", p], soft: true }),
};
