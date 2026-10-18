/**
 * Tools a run's worker may use without asking — granted by you elsewhere (an agent routine's permission page, for example), handed to
 * the CLI as --allowedTools so its own safety check doesn't refuse what you have approved. A plugin adds a provider; this knows none.
 * Server only.
 */
type Provider = (workRunId: number) => string[];
const providers: Provider[] = [];

export const addApprovedTools = (p: Provider): void => void (providers.includes(p) || providers.push(p));

/** The tools approved in advance for this work run. */
export const approvedToolsFor = (workRunId: number): string[] => [...new Set(providers.flatMap((p) => p(workRunId)))];
