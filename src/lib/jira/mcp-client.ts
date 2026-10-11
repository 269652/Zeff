import { spawn } from "node:child_process";
import { ABORTED, onAbort } from "@/lib/abort";
import { t } from "@/lib/i18n/server";

export type McpStdioConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Name used in error messages, e.g. "Roar" (default "MCP server"). */
  label?: string;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};

/** A tool caller bound to an open MCP session. Returns the raw tools/call result envelope. */
export type ToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Open one stdio MCP session (spawn + initialize handshake), run `body` with a
 * `call` function that can invoke any number of tools over the same process, then
 * shut the server down. Pure JSON-RPC over stdin/stdout — no LLM involved. This
 * amortizes the server's cold start (~30s) across many calls (e.g. board sync).
 */
export function runStdioSession<T>(
  config: McpStdioConfig,
  body: (call: ToolCaller) => Promise<T>,
  timeoutMs = 150000,
): Promise<T> {
  const label = config.label ?? t("MCP server");
  return new Promise<T>((resolve, reject) => {
    let child;
    try {
      child = spawn(config.command, config.args, {
        env: { ...process.env, ...config.env },
        cwd: config.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (e) {
      reject(new Error(t("Cannot start the {label} (\"{command}\"): {error}", { label, command: config.command, error: (e as Error).message })));
      return;
    }

    let stderr = "";
    let buffer = "";
    let settled = false;
    let nextId = 1;
    const pending = new Map<number, (r: JsonRpcResponse) => void>();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopListening();
      try {
        child.kill();
      } catch {
        // ignore
      }
      fn();
    };
    const fail = (msg: string) => finish(() => reject(new Error(msg)));
    // The sync it's part of stopped: the driver with it.
    const stopListening = onAbort(() => fail(ABORTED));
    const timer = setTimeout(
      () => fail(`${t("{label} timed out after {ms}ms.", { label, ms: timeoutMs })}${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ""}`),
      timeoutMs,
    );

    child.on("error", (e) => fail(t("Cannot start the {label} (\"{command}\"): {error}", { label, command: config.command, error: e.message })));
    // The driver gone mid-session (crashed, not on PATH): writing to it fails here — not as an
    // uncaught EPIPE that takes the server down.
    child.stdin.on("error", (e) => fail(`${t("{label}: its input closed ({error}).", { label, error: e.message })}${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ""}`));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.stdout.on("data", (d) => {
      buffer += d.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // ignore non-JSON log lines
        }
        if (msg.id !== undefined && pending.has(Number(msg.id))) {
          const resolveFn = pending.get(Number(msg.id))!;
          pending.delete(Number(msg.id));
          resolveFn(msg);
        }
      }
    });
    child.on("exit", (code) => {
      if (!settled) fail(`${t("{label} exited early (code {code}).", { label, code })}${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ""}`);
    });

    const send = (method: string, params?: unknown): Promise<JsonRpcResponse> => {
      const id = nextId++;
      const p = new Promise<JsonRpcResponse>((res) => pending.set(id, res));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return p;
    };
    const notify = (method: string, params?: unknown) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const call: ToolCaller = async (toolName, args) => {
      const res = await send("tools/call", { name: toolName, arguments: args });
      if (res.error) throw new Error(t("tool \"{tool}\" returned an error: {error}", { tool: toolName, error: res.error.message }));
      // A tool can also report failure via isError on the result envelope.
      const result = res.result as Record<string, unknown> | undefined;
      if (result?.isError) {
        const content = Array.isArray(result.content) ? (result.content as Record<string, unknown>[]) : [];
        const text = content.map((c) => (typeof c.text === "string" ? c.text : "")).filter(Boolean).join(" ");
        throw new Error(`tool "${toolName}": ${text || t("returned an error")}`);
      }
      return res.result;
    };

    (async () => {
      const init = await send("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "zeff", version: "0.1.0" },
      });
      if (init.error) return fail(t("{label} initialize failed: {error}", { label, error: init.error.message }));
      notify("notifications/initialized");
      const out = await body(call);
      finish(() => resolve(out));
    })().catch((e) => fail(`${label}: ${(e as Error).message}`));
  });
}

/** Some servers wrap the payload as `{ result: "<json string>" }` — unwrap it. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).result;
    if (typeof inner === "string") {
      try {
        return JSON.parse(inner);
      } catch {
        return inner;
      }
    }
    return inner;
  }
  return v;
}

/** Extract usable JSON (or text) from an MCP tools/call result envelope. */
export function resultToPayload(result: unknown): unknown {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.structuredContent !== undefined) return unwrap(r.structuredContent);
    if (Array.isArray(r.content)) {
      for (const c of r.content as Record<string, unknown>[]) {
        if (c.type === "text" && typeof c.text === "string") {
          try {
            return unwrap(JSON.parse(c.text));
          } catch {
            return c.text;
          }
        }
        if (c.resource) return c.resource;
      }
    }
  }
  return result;
}

/**
 * Jira not there to answer (its maintenance page, a proxy's error page instead of data): what to
 * say instead of the tool's raw error — null when it's another error.
 */
export function jiraDown(message: string): string | null {
  if (!/<!DOCTYPE html|<html|Maintenance|Wartung|502 Bad Gateway|503 Service|504 Gateway/i.test(message)) return null;
  const maintenance = /Maintenance|Wartung/i.test(message);
  return maintenance
    ? t("Jira can't be reached right now (maintenance page) — try again later.")
    : t("Jira can't be reached right now (it answers with an error page instead of data) — try again later.");
}
