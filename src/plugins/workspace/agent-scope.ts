import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Whether the code running is an AI's tool (the MCP server's, the Workspace chat's, an auto action's method) — not you. The
 * store reads it: system pages (prompts, detail views, instructions) and what is under them are read-only there — a mail
 * with instructions in it must not change a prompt for good. Server only.
 */
export const agentScope = new AsyncLocalStorage<boolean>();
export const inAgentScope = (): boolean => agentScope.getStore() === true;

/** A tool handler run in the agent scope. */
export const asAgent = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => agentScope.run(true, () => fn(...a));
