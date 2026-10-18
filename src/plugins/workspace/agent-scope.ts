import { AsyncLocalStorage } from "node:async_hooks";
import { journaled } from "./undo";

/**
 * Whether the code running is an AI's tool (the MCP server's, the Workspace chat's, an auto action's method) — not you. The
 * store reads it: system pages (prompts, detail views, instructions) and what is under them are read-only there — a mail
 * with instructions in it must not change a prompt for good. Server only.
 */
export const agentScope = new AsyncLocalStorage<boolean>();
export const inAgentScope = (): boolean => agentScope.getStore() === true;

/** A tool handler run in the agent scope. */
export const asAgent = <A extends unknown[], R>(fn: (...a: A) => R, label = "AI") => (...a: A): R => agentScope.run(true, () => journaled(label, () => fn(...a), "ai"));

/**
 * Further checks of what an AI's tool may write — a page (or the parent a page is made under; null: at the top). An agent routine's
 * permissions are one: its worker's MCP requests may change only what its scope allows. A guard throws to refuse.
 */
const guards: ((pageId: number | null) => void)[] = [];
export const addAgentGuard = (g: (pageId: number | null) => void): void => void (guards.includes(g) || guards.push(g));
export const runAgentGuards = (pageId: number | null): void => guards.forEach((g) => g(pageId));
