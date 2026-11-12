import { HarnessKernel } from "@/plugins/notebook/kernel";
import { versionOf, type KernelLanguage } from "@/plugins/notebook/languages";
import { NODE_HARNESS } from "./harness";

/** Node.js: a REPL program (harness.ts) in a container of node:22-slim, or run by Zeff's own Node.js. */
export const nodejs: KernelLanguage = {
  id: "node",
  label: "Node.js",
  monaco: "javascript",
  extension: "js",
  version: versionOf(NODE_HARNESS),
  docker: { image: "node:22-slim", program: ["node"] },
  probe: async () => ({ program: [process.execPath], version: process.versions.node }),
  start: (ctx) => HarnessKernel.start(ctx, { file: "_zeff_kernel.cjs", source: NODE_HARNESS, args: (p) => [p], soft: false }),
};
