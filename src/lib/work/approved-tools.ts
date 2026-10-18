/**
 * Tools a run's worker may use without asking — granted by you elsewhere (an agent routine's permission page, for example), handed to
 * the CLI as --allowedTools so its own safety check doesn't refuse what you have approved. A plugin adds a provider; this knows none.
 * Server only.
 */
import { getPref, setPref } from "@/lib/prefs";

type Provider = (workRunId: number) => string[];
const providers: Provider[] = [];

export const addApprovedTools = (p: Provider): void => void (providers.includes(p) || providers.push(p));

const key = (workRunId: number) => `work:approved:${workRunId}`;

/** Tools approved for one run by whoever starts it (before the run starts: the routine page may not know the run yet). */
export const grantTools = (workRunId: number, tools: string[]): void => setPref(key(workRunId), [...new Set(tools)]);

/** The tools approved in advance for this work run. */
export const approvedToolsFor = (workRunId: number): string[] => [...new Set([...getPref<string[]>(key(workRunId), []), ...providers.flatMap((p) => p(workRunId))])];
