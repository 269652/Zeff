import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The Zeff work run an MCP request comes from (header X-Zeff-Run, set in the MCP config of a live
 * session): the tools can tell "my own session" from an agent outside Zeff.
 */
export const RUN_HEADER = "x-zeff-run";

const scope = new AsyncLocalStorage<number>();

export const callerRunId = (): number | undefined => scope.getStore();

export function withCallerRun<T>(header: string | null, fn: () => T): T {
  const id = Number(header);
  return Number.isInteger(id) && id > 0 ? scope.run(id, fn) : fn();
}
