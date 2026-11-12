import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { Kernel } from "./kernel";

/**
 * The languages a code block can run: each is brought by a plugin of its own (Notebook · Python, Notebook · Node.js,
 * Notebook · Rust …) that contributes a `KernelLanguage` here from its server.ts. So a language is there only while its plugin
 * is installed, and a new one is a new plugin. Where a session runs — in a Docker container (the default) or on this computer —
 * is the core's choice (runner.ts); the language only says what to start and how to find it. Server only.
 */

export type Where = "docker" | "host";

/** A process the session started, and how to end it (a container: removed; a program: its tree). */
export type Spawned = { child: ChildProcess; kill(): void };

/** What a language's kernel is given to start with. */
export type KernelContext = {
  /** The session's folder (in a container: mounted as /work). */
  dir: string;
  where: Where;
  /** The interpreter (with its fixed arguments) as it is called where the session runs: `["python"]` in a container, `["py", "-3"]` on this computer. */
  program: string[];
  /** A file of the session's folder as the process sees it. */
  path(file: string): string;
  /** Start a process (argv: program and arguments as they are called there). stdin: a pipe (else none). */
  spawn(argv: string[], opts?: { env?: Record<string, string>; stdin?: boolean }): Spawned;
  /** A line for the cell that waits for the session to start (pulling an image). */
  note(text: string): void;
};

export type KernelLanguage = {
  /** What the code block calls it ("python"). */
  id: string;
  label: string;
  /** The editor's language for highlighting ("python", "javascript", "rust"). */
  monaco: string;
  /** For a file of that language ("py"). */
  extension: string;
  /** What runs it in a container: the image, and the interpreter in it. */
  docker: { image: string; program: string[] };
  /** The interpreter on this computer (and its version); null when there is none. */
  probe(): Promise<{ program: string[]; version: string } | null>;
  /** A session of it. */
  start(ctx: KernelContext): Promise<Kernel>;
  /** Which version of the program the sessions run (a hash of it): a session started with another version is started again, so what the plugin brings later is there. */
  version?: string;
};

/** A short hash of the texts a kernel is made of (its harness, its prelude). */
export const versionOf = (...parts: string[]): string => crypto.createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 10);

export const kernelLanguages = extensionPoint<KernelLanguage>("notebook.kernelLanguages");

/** The languages of the plugins that are installed. */
export const installedLanguages = (): KernelLanguage[] => kernelLanguages.list().map((c) => c.impl);
export const languageById = (id: string): KernelLanguage | undefined => installedLanguages().find((l) => l.id === id);
