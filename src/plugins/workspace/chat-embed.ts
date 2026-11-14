/**
 * What a tool can show in the Workspace assistant's answer besides its text (the sidebar chat, ChatPanel.tsx): a tool's
 * result carries it under CHAT_EMBED — a symbol, so it never goes out over the MCP (JSON leaves it out) and only the
 * assistant (agent.ts) picks it up. Client-safe.
 */
import type { PickCriteria, PickGroupId } from "@/plugins/jira-lage/pick";

export const CHAT_EMBED: unique symbol = Symbol.for("zeff.chatEmbed");

export type EmbedTicket = { rowId: number; key: string; title: string; status: string; assignee: string; priority: string; mine: boolean; /** Why the assistant picked it. */ why?: string };

/** A filtered Jira board: its tickets in groups, and the address that opens the board with the same filter. */
export type TicketsEmbed = { kind: "tickets"; dbId: number; board: string; href: string; criteria: PickCriteria; groups: { id: PickGroupId; total: number; tickets: EmbedTicket[] }[] };

/** A widget the assistant built (workspace_widget): its code, what it asks to be allowed, the page it was put into (if any). */
export type WidgetEmbed = { kind: "widget"; href: string; title: string; html: string; libs: string[]; writes: number[]; ai: boolean; flows?: string[]; pageId: number | null };

/** A mod the assistant wrote (workspace_mod_save): off until the user switches it on — right here, under the answer. */
export type ModEmbed = { kind: "mod"; href: string; id: string; name: string; description: string; problems: string[]; isNew: boolean; accounts?: string[]; hooks: string[] };

export type ChatEmbed = TicketsEmbed | WidgetEmbed | ModEmbed;

/** The embeds a tool's result carries (none: []). */
export const embedsOf = (res: unknown): ChatEmbed[] => (res && typeof res === "object" ? ((res as { [CHAT_EMBED]?: ChatEmbed[] })[CHAT_EMBED] ?? []) : []);

/** A tool's result with embeds attached. */
export const withEmbeds = <T extends object>(res: T, embeds: ChatEmbed[]): T => (embeds.length ? Object.assign(res, { [CHAT_EMBED]: embeds }) : res);
