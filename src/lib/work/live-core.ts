import { spawn } from "node:child_process";
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import { currentAccountId, withAccount } from "@/db/accounts";
import { delegates } from "@/lib/host/role";
import { killPid, sleep } from "@/lib/abort";
import { lastJson } from "@/lib/ai/json";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { closeOnHost, killOnHost, spawnOnHost, workHostFeatures, writeToHost } from "@/lib/work/host";
import { errPath, inPath, logPath, workDir } from "@/lib/work/log";
import { normalizeResult } from "@/lib/work/outcome";
import { RunMap } from "@/lib/work/run-map";
import { connectHost, newLines, pidAlive, readHostInfo } from "@/lib/work/session-host";
import { WORK_RESULT_SCHEMA, workRef, type ClaudeAsk, type SessionLiveView, type WorkResult } from "@/lib/work/shared";
import type { LiveView } from "@/plugins/copilot-cli/live-state";

/**
 * What every live session has in common, whatever CLI runs it (Claude Code's stream-json in
 * plugins/claude-cli/live.ts, Codex's app-server JSON-RPC in plugins/codex-cli/live.ts): its
 * process outside Zeff's server (the launcher's work host, or a host of its own:
 * scripts/work-session-host.mjs), its config beside its log, the log and Zeff's side log
 * (log.ts: inPath) followed line by line on one timer, its end (a result, its process gone, a
 * question nobody answers), and what you do to it that doesn't depend on its protocol (close,
 * kill, finish, a model). A provider's module hands in an adapter — how a line is read, when it
 * is busy, what else happens at its turns' ends — and keeps its protocol (spawn arguments,
 * control messages, its outcome) to itself.
 */

/** Where the CLI runs: the launcher's work host, or a host of its own (administrator, no launcher). */
export type Transport = "launcher" | "own";

/** What every session was started with — kept beside its log (a restarted server reads it). */
export type LiveCfgBase = {
  runId: number;
  conversation: boolean;
  /** Run as administrator, under its own elevated host (Claude only). */
  elevated?: boolean;
  model: string | null;
  allowBypass: boolean;
  askTimeoutMin: number;
  command: string;
  args: string[];
  cwd: string;
  /** Where it runs now, and (own host) the token Zeff talks to it with / (launcher) its pid. */
  transport?: Transport;
  token: string;
  pid?: number | null;
  /** Asked for its result (finish): its next result ends the run. */
  finishing?: boolean;
  /** Closed by you without a result. */
  closing?: boolean;
};

export type LiveFiles = { log: string; err: string; in: string; info: string; cfg: string; host: string };

/** A session, server side — what every provider's has; theirs add their protocol's state. */
export type LiveBase<C extends LiveCfgBase = LiveCfgBase> = {
  runId: number;
  account: string;
  files: LiveFiles;
  cfg: C;
  /** Read so far: the log and the side log. */
  offset: number;
  rest: string;
  inOffset: number;
  inRest: string;
  /** Answered (by Zeff's side log, or resolved by the CLI): asks that are no longer open. */
  answered: Set<string>;
  sock: net.Socket | null;
  connecting: Promise<net.Socket> | null;
  view: SessionLiveView;
  /** What it said this turn, and what it said last (when it waits for you). */
  turnText: string;
  waiting: string | null;
  /** A turn's end arrived since the last check: maybe the end. */
  resultSeen: boolean;
  exited: boolean;
  /** Waiting for its process to come up (since). */
  startingSince: number | null;
  closed: boolean;
  /** Ticks its process was found gone without an end of its own (killed). */
  missing: number;
  ticks: number;
  stopSent: boolean;
  /** Its logs read up to their end once (after a restart: until then, where it stands isn't known). */
  caughtUp: boolean;
};

/** What a provider hands the core: its protocol's side of following, viewing and ending a session. */
export type LiveAdapter<C extends LiveCfgBase, L extends LiveBase<C>> = {
  /** Its globalThis keys: the sessions (by id only, before runs were per account), the per-account map, the timer. */
  keys: { map: string; runs: string; tick: string };
  /** Its session files' names in sessions/: `<run><infix>.json` … (Claude's: none). */
  infix: string;
  /** A session's state, new (started, or reattached after a restart). */
  create(runId: number, cfg: C): L;
  /** One line of the log (what the CLI printed), and one of Zeff's side log. */
  take(l: L, line: string): void;
  takeIn(l: L, line: string): void;
  /** A turn under way. */
  busy(l: L): boolean;
  /** Ready to take a message beyond its host being up (Codex: its thread there, the first message sent). */
  ready?(l: L): boolean;
  /** Waits for you, beyond not working and nothing asked (Codex: nothing queued either). */
  idle?(l: L): boolean;
  /** Its mode now, the modes the sidebar shows, and what the pages see of it besides the view. */
  mode(l: L): string;
  sidebarModes(l: L): { id: string; name: string }[];
  /** The input fields its asks' details come from (the first there is). */
  detailFields: string[];
  session(l: L): Partial<SessionLiveView>;
  /** After the logs were read (caught up): what waited goes out (Codex: the next turn). */
  afterFollow?(l: L): void;
  /** Its process ended: its protocol's turn state reset. */
  onExit(l: L): void;
  /** Before its end is looked at: true when that settled it (Codex: its thread didn't start). */
  beforeSettle?(l: L): boolean;
  /** A conversation's turn ended with a result (Claude: taken in now, the session stays open). */
  onTurnResult?(l: L, r: WorkResult): Promise<void>;
  /** Its process ended: true when that's not its end (Claude: a restart with another effort). */
  onExited?(l: L): boolean;
  /** What a task's question nobody answered is refused with. */
  askTimeoutMessage(min: number): string;
  answer(runId: number, requestId: string, a: { behavior: "deny"; message: string }): Promise<void>;
  /** A failure: its process taken as gone (Claude), or only when it is (Codex). */
  failKeepsProcess?: boolean;
  /** What Zeff sent, as kept beside the log (images as their size, tokens hidden). */
  scrub?(msg: Record<string, unknown>): Record<string, unknown>;
  /** Its session dropped: what else goes (Codex: the pictures you sent). */
  onDrop?(l: L): void;
  /** Your message (finish asks for its result with one). */
  send(runId: number, text: string): Promise<void>;
};

export const now = () => new Date().toISOString();
export const sessionsDir = () => path.join(workDir(), "sessions");

/** The script a session's own host runs (Zeff's checkout). */
export const hostScript = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "work-session-host.mjs");

export function changed(alsoAttention = false) {
  emitChange("work");
  if (alsoAttention) emitChange("attention");
}

/** Its result in what it said: the last ```json block (or object) that is one. */
export const resultOf = (text: string): WorkResult | null => normalizeResult(lastJson(text));

let nextReq = 0;
/** An id for a request of Zeff's. */
export const reqId = () => `zeff-${Date.now().toString(36)}-${++nextReq}`;

/** What it asks, in a few words. */
export function askTitle(a: ClaudeAsk): string {
  if (a.tool === "ExitPlanMode") return t("Its plan — go ahead?");
  if (a.tool === "AskUserQuestion") return t("A question for you");
  return `${a.tool}${a.description ? `: ${a.description}` : ""}`;
}

/** What it asks, in more words: its question(s), else the first of these input fields there is (else all of it). */
export function askDetail(a: ClaudeAsk, fields: string[]): string | null {
  const i = a.input;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  if (a.tool === "AskUserQuestion") return ((i.questions as { question?: string }[] | undefined) ?? []).map((q) => q.question).join(" · ");
  return (fields.map(s).find(Boolean) || JSON.stringify(i)).slice(0, 600);
}

/** The message finish sends: its result now, as a ```json block. */
export const FINISH_TEXT = () =>
  `Schließ jetzt ab: fasse zusammen, was du in dieser Session getan hast, und antworte mit dem Ergebnis als JSON in einem \`\`\`json-Block, nach diesem Schema:\n${JSON.stringify(WORK_RESULT_SCHEMA)}`;

/** How its process is started: the launcher's host (unless elevated) or a host of its own. */
export type LaunchOpts = {
  /** The launcher's host reported it up once it runs (no start line of its own) — else its first log line says so. */
  upOnSpawn?: boolean;
  /** Right after its last process ended the launcher's host may still be reporting it: retried a while. */
  retryStarted?: boolean;
};

/** The shared core for one provider's sessions. */
export function liveCore<C extends LiveCfgBase, L extends LiveBase<C>>(a: LiveAdapter<C, L>) {
  // Per account (a run's id is its account's): two accounts served side by side never see or steer each other's session. The
  // sessions of an earlier map (by id only) are taken over.
  const state = globalThis as unknown as Record<string, unknown>;
  const lives = (state[a.keys.runs] ??= new RunMap<L>(currentAccountId, state[a.keys.map] as Map<number, L> | undefined)) as RunMap<L>;

  const filesOf = (runId: number): LiveFiles => ({
    log: logPath(runId),
    err: errPath(runId),
    in: inPath(runId),
    cfg: path.join(sessionsDir(), `${runId}${a.infix}.json`),
    host: path.join(sessionsDir(), `${runId}${a.infix}.host-cfg.json`),
    info: path.join(sessionsDir(), `${runId}${a.infix}.host.json`),
  });

  /** This run is (or was) one of its sessions. */
  const isSession = (runId: number) => fs.existsSync(/*turbopackIgnore: true*/ filesOf(runId).cfg);

  function readCfg(runId: number): C | null {
    try {
      return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filesOf(runId).cfg, "utf8")) as C;
    } catch {
      return null;
    }
  }

  function saveCfg(l: L) {
    fs.writeFileSync(/*turbopackIgnore: true*/ l.files.cfg, JSON.stringify(l.cfg, null, 1));
  }

  /** The state every session starts with (its provider's added to it). */
  function base(runId: number, cfg: C, view: SessionLiveView): LiveBase<C> {
    return {
      runId,
      account: currentAccountId(),
      files: filesOf(runId),
      cfg,
      offset: 0,
      rest: "",
      inOffset: 0,
      inRest: "",
      answered: new Set(),
      sock: null,
      connecting: null,
      view,
      turnText: "",
      waiting: null,
      resultSeen: false,
      exited: false,
      startingSince: null,
      closed: false,
      missing: 0,
      ticks: 0,
      stopSent: false,
      caughtUp: false,
    };
  }

  const ready = (l: L) => (a.ready ? a.ready(l) : true);

  /** The live session as the pages see it (the Copilot-shaped part for the sidebar and attention; the rest under `session`). */
  function view(runId: number): { live: LiveView; session: SessionLiveView } | undefined {
    const l = lives.get(runId);
    if (!l || l.closed) return undefined;
    const ask = l.view.asks[0];
    const starting = l.view.host === "starting" || !ready(l);
    const live: LiveView = {
      mode: a.mode(l),
      modes: a.sidebarModes(l),
      busy: a.busy(l) || !!ask || starting || !l.caughtUp,
      permission: ask ? { title: askTitle(ask), detail: askDetail(ask, a.detailFields), options: [] } : null,
      waiting: !a.busy(l) && !ask && !starting && l.caughtUp ? (l.waiting ?? "") : null,
    };
    return { live, session: { ...l.view, asks: [...l.view.asks], ...a.session(l) } };
  }

  /** Waits for you (not working, nothing asked): it doesn't hold a worker. */
  function idle(runId: number): boolean {
    const l = lives.get(runId);
    return !!l && !l.closed && l.caughtUp && !a.busy(l) && !l.view.asks.length && l.view.host === "up" && (!a.idle || a.idle(l));
  }

  // ——— the logs, followed ———

  /** The logs' new lines, then what follows from them. */
  function follow(l: L) {
    const asksBefore = l.view.asks.length;
    const busyBefore = a.busy(l);
    // The side log first: an answer known before its question is read again (after a restart), a request before its response.
    const inPos = { offset: l.inOffset, rest: l.inRest };
    const ins = newLines(l.files.in, inPos);
    l.inOffset = inPos.offset;
    l.inRest = inPos.rest;
    for (const line of ins ?? []) a.takeIn(l, line);
    const pos = { offset: l.offset, rest: l.rest };
    const lines = newLines(l.files.log, pos);
    l.offset = pos.offset;
    l.rest = pos.rest;
    for (const line of lines ?? []) a.take(l, line);
    if (!lines && !l.caughtUp) {
      l.caughtUp = true;
      changed();
    }
    a.afterFollow?.(l);
    if (lines || ins) {
      changed(asksBefore !== l.view.asks.length || busyBefore !== a.busy(l));
      void settle(l);
    } else if (++l.ticks % 5 === 0) void settle(l);
  }

  /** Its process ended (its own host said so in the log, or the launcher's reported it): a restart, or its end. */
  function onExit(l: L) {
    l.exited = true;
    l.view.host = "down";
    a.onExit(l);
    l.view.asks = [];
    l.sock?.destroy();
    l.sock = null;
  }

  /** After new lines: its end (a result for a task, an asked-for result, its process gone), a restart, questions nobody answered. */
  /** This server only watches the sessions (it hands the work to Zeff's own — the phone's server). */
  const watchOnly = () => delegates();

  async function settle(l: L) {
    if (l.closed) return;
    const { getRun } = await import("@/lib/work/store");
    const run = getRun(l.runId);
    // Only watching (the phone's server: Zeff's own follows the session and acts on it) — shown while it runs, nothing more.
    if (watchOnly()) {
      if (!run || run.status !== "running") drop(l);
      return;
    }
    if (!run || run.status !== "running") {
      // Stopped or finished meanwhile: its process goes too.
      if (!l.exited && !l.stopSent) {
        l.stopSent = true;
        void stopProcess(l);
      }
      if (l.exited || l.missing > 5) drop(l);
      else if (!processAlive(l)) l.missing++;
      return;
    }
    if (a.beforeSettle?.(l)) return;
    if (l.resultSeen && !a.busy(l)) {
      l.resultSeen = false;
      // A turn ended: a chat that keeps its conversation elsewhere (Learn's lessons) writes it down now.
      void import("./conversation-guard").then((m) => m.conversationTurn(l.runId));
      const ended = !l.cfg.conversation || l.cfg.finishing;
      const turnResult = resultOf(l.turnText);
      if (ended && turnResult) {
        await end(l);
        return;
      }
      if (turnResult && a.onTurnResult) await a.onTurnResult(l, turnResult);
    }
    if (l.exited) {
      if (a.onExited?.(l)) return;
      await end(l);
      return;
    }
    // Its process gone without an end of its own (killed): a few ticks (a normal end comes in meanwhile), then the end.
    l.missing = l.startingSince === null && l.view.host === "up" && !processAlive(l) ? l.missing + 1 : 0;
    if (l.missing > (l.cfg.transport === "launcher" ? 75 : 5)) {
      l.exited = true;
      await end(l, true);
      return;
    }
    // A task's question nobody answers: refused after a while, so the run goes on.
    if (!l.cfg.conversation && l.cfg.askTimeoutMin > 0) {
      const limit = Date.now() - l.cfg.askTimeoutMin * 60000;
      for (const x of l.view.asks.filter((q) => Date.parse(q.at) < limit)) {
        void a.answer(l.runId, x.requestId, { behavior: "deny", message: a.askTimeoutMessage(l.cfg.askTimeoutMin) }).catch(() => {});
      }
    }
    // A process that never came up (UAC declined, the task failed, the host refused).
    if (l.startingSince !== null && Date.now() - l.startingSince > (l.cfg.elevated ? 180000 : 60000) && !processAlive(l)) {
      l.startingSince = null;
      fail(l, new Error(l.cfg.elevated ? t("The administrator session didn't start (UAC declined, or the Admin sessions task failed).") : t("The session didn't start.")));
    }
  }

  /** Its process there: on the launcher's host (its pid), or its own host (its info file and pid). */
  function processAlive(l: L): boolean {
    if (l.cfg.transport === "launcher") return pidAlive(l.cfg.pid);
    const info = readHostInfo(l.files.info);
    return !!info && (!!info.elevated || pidAlive(info.pid));
  }

  function fail(l: L, e: unknown) {
    fs.appendFileSync(/*turbopackIgnore: true*/ l.files.err, `${e instanceof Error ? e.message : String(e)}\n`);
    l.exited = a.failKeepsProcess ? l.exited || !processAlive(l) : true;
    void end(l, true);
  }

  /** The run taken in (finalize reads the log through the driver's outcome); its process told to go. */
  async function end(l: L, gone = false) {
    if (l.closed) return;
    if (watchOnly()) return drop(l);
    l.closed = true;
    const { finalize } = await import("@/lib/work/runner");
    await withAccount(l.account, () => finalize(l.runId, gone && !l.cfg.closing));
    if (!l.exited) await stopProcess(l);
    drop(l);
  }

  function drop(l: L) {
    l.closed = true;
    l.sock?.destroy();
    lives.delete(l.runId, l.account);
    fs.rmSync(/*turbopackIgnore: true*/ l.files.host, { force: true });
    a.onDrop?.(l);
    changed(true);
  }

  // ——— its process: on the launcher's work host, or a host of its own ———

  function connect(l: L): Promise<net.Socket> {
    if (l.sock && !l.sock.destroyed) return Promise.resolve(l.sock);
    // The host up (its info file) — an admin one may wait on UAC a while.
    l.connecting ??= connectHost(l.files.info, l.cfg.token, { waitMs: l.cfg.elevated ? 180000 : 45000, gone: () => l.exited })
      .then((sock) => {
        sock.on("close", () => {
          if (l.sock === sock) l.sock = null;
        });
        l.sock = sock;
        return sock;
      })
      .finally(() => {
        l.connecting = null;
      });
    return l.connecting;
  }

  /** One line to its own host (a message for the CLI, or one for the host: stop, kill). */
  async function hostSend(l: L, msg: Record<string, unknown>) {
    const s = await connect(l);
    await new Promise<void>((resolve, reject) => s.write(`${JSON.stringify(msg)}\n`, (e) => (e ? reject(e) : resolve())));
  }

  /** What Zeff sent, kept beside the log. */
  function keep(l: L, msg: Record<string, unknown>) {
    const scrubbed = a.scrub ? a.scrub(msg) : msg;
    fs.appendFileSync(/*turbopackIgnore: true*/ l.files.in, `${JSON.stringify({ type: "zeff_in", at: now(), msg: scrubbed })}\n`);
  }

  /** One line to the CLI — kept beside the log, then sent where it runs. */
  async function write(l: L, msg: Record<string, unknown>) {
    keep(l, msg);
    if (l.cfg.transport === "launcher") await writeToHost(l.runId, JSON.stringify(msg));
    else await hostSend(l, msg);
  }

  /** Its input ended: it finishes and quits. */
  async function stopProcess(l: L) {
    if (l.cfg.transport === "launcher") await closeOnHost(l.runId);
    else await hostSend(l, { zeffHost: "stop" }).catch(() => {});
  }

  /**
   * Its process started with these arguments and first lines — as administrator under its own
   * elevated host, else on the launcher's work host, else (no launcher) under a host of its own.
   */
  async function launch(l: L, args: string[], lines: Record<string, unknown>[], opts: LaunchOpts = {}) {
    l.view.host = "starting";
    l.startingSince = Date.now();
    l.exited = false;
    changed();
    const { workerEnv } = await import("@/lib/work/runner");
    // The launcher's host — when its code knows live sessions (one started before an update doesn't, till it restarts).
    const features = l.cfg.elevated ? null : await workHostFeatures();
    if (features?.includes("keep") && features.includes("write")) {
      l.cfg.transport = "launcher";
      for (const m of lines) keep(l, m);
      for (let i = 0; ; i++) {
        try {
          l.cfg.pid = await spawnOnHost({
            runId: l.runId,
            account: l.account,
            command: l.cfg.command,
            args,
            cwd: l.cfg.cwd,
            env: workerEnv(l.runId, true),
            stdin: "",
            stdinLines: lines.map((m) => JSON.stringify(m)),
            outFile: l.files.log,
            errFile: l.files.err,
            live: true,
            keep: true,
          });
          break;
        } catch (e) {
          if (!opts.retryStarted || i >= 20 || !/started already/.test(String(e))) throw e;
          await sleep(500);
        }
      }
      if (opts.upOnSpawn) {
        l.view.host = "up";
        l.startingSince = null;
      }
      saveCfg(l);
      const { updateRun } = await import("@/lib/work/store");
      updateRun(l.runId, { pid: l.cfg.pid });
      return;
    }
    // A host of its own: its config (the token Zeff talks to it with), started detached — or elevated.
    l.cfg.transport = "own";
    saveCfg(l);
    const hostCfg = { command: l.cfg.command, args, cwd: l.cfg.cwd, log: l.files.log, err: l.files.err, info: l.files.info, token: l.cfg.token, ...(l.cfg.elevated === undefined ? {} : { elevated: l.cfg.elevated }) };
    fs.writeFileSync(/*turbopackIgnore: true*/ l.files.host, JSON.stringify(hostCfg));
    fs.rmSync(/*turbopackIgnore: true*/ l.files.info, { force: true });
    if (l.cfg.elevated) {
      const { startElevatedHost } = await import("@/plugins/work-elevated/elevate");
      await startElevatedHost(l.files.host);
    } else {
      if (!fs.existsSync(/*turbopackIgnore: true*/ hostScript())) throw new Error(t("The session host is missing: {path} (Zeff runs from {cwd}).", { path: hostScript(), cwd: process.cwd() }));
      // What goes wrong starting it (node's own errors) into the run's error output.
      const err = fs.openSync(/*turbopackIgnore: true*/ l.files.err, "a");
      // --detach: the host starts itself once more and this one goes — out of the server's process tree.
      const child = spawn(/*turbopackIgnore: true*/ process.execPath, [hostScript(), l.files.host, "--detach"], { cwd: l.cfg.cwd, env: workerEnv(l.runId, true) as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "ignore", err], windowsHide: true });
      fs.closeSync(err);
      child.on("error", (e) => fail(l, e));
      child.on("exit", (code) => code && fail(l, new Error(t("The session host didn't start (exit {code}) — see above.", { code }))));
      child.unref();
    }
    for (const m of lines) await write(l, m);
  }

  /** Follow every live session's logs (one timer for all). */
  function ensureTick() {
    if (state[a.keys.tick]) return;
    const tick = setInterval(() => {
      for (const l of lives.values()) {
        try {
          withAccount(l.account, () => follow(l));
        } catch (e) {
          console.error(`[work] following ${workRef(l.runId)} failed:`, e);
        }
      }
    }, 400);
    state[a.keys.tick] = tick;
    tick.unref?.();
  }

  /** A new session followed from now on. */
  function register(l: L) {
    lives.set(l.runId, l);
    ensureTick();
  }

  /**
   * After a server start: the live sessions of the last one — still running on their host — are
   * followed again, their logs read from the start (where things stand); one gone meanwhile ends.
   */
  function reattach(runIds: number[]): void {
    for (const runId of runIds) {
      if (lives.has(runId)) continue;
      const cfg = readCfg(runId);
      if (!cfg) continue;
      const l = a.create(runId, cfg);
      l.view.host = processAlive(l) ? "up" : "down";
      // Its process gone meanwhile: it ends (read to its end first) — else, "down" for good, it held a worker forever.
      if (l.view.host === "down") l.exited = true;
      lives.set(runId, l);
    }
    ensureTick();
  }

  // ——— what you do ———

  const liveOf = (runId: number): L => {
    const l = lives.get(runId);
    if (!l || l.closed) throw new Error(t("The session isn't running (any more)."));
    return l;
  };

  /** Its model, from the next turn on (`tell`: the CLI told first). */
  async function setModel(runId: number, model: string, tell?: (l: L) => Promise<void>) {
    const l = liveOf(runId);
    if (!/^[\w.[\]-]{1,80}$/.test(model)) throw new Error(t("Unknown model."));
    await tell?.(l);
    l.cfg.model = model;
    l.view.model = model;
    saveCfg(l);
    changed();
  }

  /** Finish: it's asked for its result now — that ends the run (and books it, ticks off its todo …). */
  async function finish(runId: number) {
    const l = liveOf(runId);
    l.cfg.finishing = true;
    saveCfg(l);
    await a.send(runId, FINISH_TEXT());
  }

  /** Close: end the session without a result (nothing ticked off, nothing booked). */
  async function close(runId: number) {
    const l = liveOf(runId);
    l.cfg.closing = true;
    saveCfg(l);
    if (l.exited) await end(l);
    else await stopProcess(l);
  }

  /** Stop it hard (Stop): the CLI and everything it started. */
  function kill(runId: number) {
    const l = lives.get(runId);
    const cfg = l?.cfg ?? readCfg(runId);
    const files = l?.files ?? filesOf(runId);
    if (cfg?.transport === "launcher") void killOnHost(runId);
    else {
      const info = readHostInfo(files.info);
      // Over its socket (it kills its CLI's tree and ends) — and, ours (not elevated), its whole tree at once as well.
      if (l && !l.exited) void hostSend(l, { zeffHost: "kill" }).catch(() => {});
      if (info?.pid && !info.elevated && pidAlive(info.pid)) {
        killPid(info.pid);
      }
    }
    if (l) l.closed = true;
    lives.delete(runId, l?.account);
    changed(true);
  }

  /** A log read whole (none: ""). */
  const readAll = (file: string) => {
    try {
      return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
    } catch {
      return "";
    }
  };

  return {
    lives,
    filesOf,
    isSession,
    readCfg,
    saveCfg,
    base,
    view,
    idle,
    onExit,
    processAlive,
    fail,
    end,
    hostSend,
    keep,
    write,
    stopProcess,
    launch,
    register,
    reattach,
    liveOf,
    setModel,
    finish,
    close,
    kill,
    readAll,
  };
}
