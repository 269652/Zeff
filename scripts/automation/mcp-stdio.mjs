/**
 * The stdio MCP server loop the drivers share (newline-delimited JSON-RPC): initialize, tools/list,
 * tools/call → one handler per tool. A tool's handler returns the text to answer; a throw becomes an
 * `Error: …` result (isError) — never a crashed driver.
 *
 *   serveMcp({ name, tools, handlers: { tool_name: (args) => Promise<string> }, log, version? })
 *
 * `handle(msg)` is exported separately (`createMcp`) so tests can drive it without a process.
 */

const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** @returns {{ handle(msg: any): Promise<any|undefined> }} answers each JSON-RPC message (undefined: none to send). */
export function createMcp({ name, version = "0.1.0", tools, handlers, log = () => {} }) {
  return {
    async handle(msg) {
      const { id, method, params } = msg || {};
      const reply = (result) => ({ jsonrpc: "2.0", id, result });
      if (method === "initialize") return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name, version } });
      if (method === "notifications/initialized") return undefined;
      if (method === "tools/list") return reply({ tools });
      if (method === "tools/call") {
        const tool = params?.name;
        const fn = handlers[tool];
        if (!fn) return reply(textResult(`Unknown tool "${tool}".`, true));
        try {
          return reply(textResult(await fn(params?.arguments || {})));
        } catch (e) {
          log("tool error:", String(e));
          return reply(textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
        }
      }
      return id !== undefined ? reply({}) : undefined;
    },
  };
}

/** Reads JSON-RPC lines from stdin and answers on stdout until stdin ends. */
export function serveMcp(options) {
  const mcp = createMcp(options);
  const log = options.log ?? (() => {});
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      Promise.resolve(mcp.handle(msg))
        .then((out) => out && process.stdout.write(`${JSON.stringify(out)}\n`))
        .catch((e) => log("handler error:", String(e)));
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
