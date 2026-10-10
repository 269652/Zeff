import { accountKnowledge } from "@/db/accounts";
import type { KnowledgeAnswer, KnowledgeEntity, KnowledgePage, KnowledgeStatus, KnowledgeTurn } from "./shared";

/**
 * The knowledge server (knowledge/, its own Next app) of the account this runs for — each account
 * its own (the first: KNOWLEDGE_URL, default http://127.0.0.1:9555; the others: their port) — and
 * its token (KNOWLEDGE_TOKEN, when it's set there too).
 */
export const knowledgeUrl = () => accountKnowledge().url;

async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (process.env.KNOWLEDGE_TOKEN) headers.authorization = `Bearer ${process.env.KNOWLEDGE_TOKEN}`;
  let r: Response;
  try {
    r = await fetch(`${knowledgeUrl()}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(init.timeoutMs ?? 10000), cache: "no-store" });
  } catch {
    throw new Error(`Der Wissens-Server dieses Kontos antwortet nicht (${knowledgeUrl()}) — läuft er? Der Launcher (Zeff.exe) startet ihn.`);
  }
  const data = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !data) throw new Error(data?.error ?? `Wissens-Server: ${r.status}`);
  return data;
}

export const knowledgeStatus = () => call<KnowledgeStatus>("/api/status", { timeoutMs: 3000 });
export const knowledgeSearch = (q: string, limit = 8) => call<{ pages: KnowledgePage[]; entities: KnowledgeEntity[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
export const knowledgeRelated = (text: string, ticket: string | null, limit = 5) => call<{ pages: KnowledgePage[]; entities: KnowledgeEntity[] }>("/api/related", { method: "POST", body: { text, ticket, limit } });
export const knowledgeAsk = (question: string, history: KnowledgeTurn[]) => call<KnowledgeAnswer>("/api/ask", { method: "POST", body: { question, history }, timeoutMs: 360000 });
export const knowledgeSync = () => call<{ started: boolean }>("/api/sync?compile=1", { method: "POST" });

/** Your own knowledge on the knowledge server: something to keep — a text, or a link (the page behind it read). Compiled right after. */
export const knowledgeAddOwn = (v: { title?: string; text?: string; url?: string }) =>
  call<{ id: string; entry: { id: string; title: string } | null }>("/api/own", { method: "POST", body: v, timeoutMs: 30000 });

/**
 * The knowledge server as your browser reaches it: beside Zeff's own address — Zeff at
 * https://zeff:1337 → https://knowledge.zeff:1337 (the launcher routes knowledge.<host> to the
 * knowledge server of the account you're in); Zeff opened on 127.0.0.1 / localhost → its port.
 */
export function knowledgeBrowserUrl(host: string | null, proto: string | null): string {
  const h = (host ?? "").trim().toLowerCase();
  if (!h || /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h)) return knowledgeUrl();
  return `${proto === "http" ? "http" : "https"}://knowledge.${h.replace(/^knowledge\./, "")}`;
}
