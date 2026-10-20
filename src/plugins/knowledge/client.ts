import { accountKnowledge } from "@/db/accounts";
import { t } from "@/lib/i18n/server";
import type { KnowledgeAnswer, KnowledgeEntity, KnowledgeEntityDetail, KnowledgePage, KnowledgePerson, KnowledgeStatus, KnowledgeTurn } from "./shared";

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
    throw new Error(t("This account's knowledge server isn't answering ({url}) — is it running? The launcher (Zeff.exe) starts it.", { url: knowledgeUrl() }));
  }
  const data = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !data) throw new Error(data?.error ?? t("Knowledge server: {status}", { status: r.status }));
  return data;
}

export const knowledgeStatus = () => call<KnowledgeStatus>("/api/status", { timeoutMs: 3000 });
export const knowledgeSearch = (q: string, limit = 8) => call<{ pages: KnowledgePage[]; entities: KnowledgeEntity[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
export const knowledgeRelated = (text: string, ticket: string | null, limit = 5) => call<{ pages: KnowledgePage[]; entities: KnowledgeEntity[] }>("/api/related", { method: "POST", body: { text, ticket, limit } });
/** The addresses of the systems a piece of work is about (test, prod …) from the pages that are about it. */
export const knowledgeLinks = (text: string, ticket: string | null, limit = 40) =>
  call<{ links: { env: "prod" | "test" | "dev" | "other"; label: string; url: string; pageTitle: string; pageUrl?: string }[] }>("/api/links", { method: "POST", body: { text, ticket, limit } }).then((r) => r.links);
/** What the knowledge holds about a project (search terms → pages with their abstract and address lines), raw material for a summary. */
export const knowledgeRepoSources = (terms: string[], limit = 14) =>
  call<{ pages: { id: string; title: string; space: string; url: string; summary: string | null; lines: string[] }[] }>("/api/repo-sources", { method: "POST", body: { terms, limit } }).then((r) => r.pages);
export const knowledgeAsk = (question: string, history: KnowledgeTurn[]) => call<KnowledgeAnswer>("/api/ask", { method: "POST", body: { question, history }, timeoutMs: 360000 });
/** Pages by id: compiled in their current version, their abstract and concepts (the Documents plugin's hover cards). */
export const knowledgePages = (ids: string[]) =>
  call<{ pages: { id: string; title: string; summary: string; concepts: string; compiled: boolean }[] }>(`/api/page?ids=${encodeURIComponent(ids.join(","))}`, { timeoutMs: 5000 }).then((r) => r.pages);
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

/** Every person the knowledge knows, the most named first. */
export const knowledgePersons = () => call<{ persons: KnowledgePerson[] }>("/api/people", { timeoutMs: 8000 }).then((r) => r.persons);

/** One person in full — by the entity's id, or by a name (one normalizing merged counts too); null when the knowledge doesn't know them. */
export async function knowledgePerson(v: { id?: number | null; name?: string }): Promise<KnowledgeEntityDetail | null> {
  const path = v.id ? `/api/people/${v.id}` : `/api/people/by-name?name=${encodeURIComponent(v.name ?? "")}`;
  try {
    return await call<KnowledgeEntityDetail>(path, { timeoutMs: 8000 });
  } catch (e) {
    if (/not found|404/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** A fact you confirmed about a person, kept with their entity (a line of their page; the same ref replaces it, an empty text removes it). */
export const knowledgePersonFact = (entityId: number, v: { ref: string; text: string }) => call<{ page: string }>(`/api/people/${entityId}/facts`, { method: "POST", body: v, timeoutMs: 8000 });

/** One person the knowledge keeps as several entities made one: `drop`'s pages, relations and names go to `keep`. */
export const knowledgeMergePeople = (keep: number, drop: number[]) => call<KnowledgeEntityDetail>("/api/people/merge", { method: "POST", body: { keep, drop }, timeoutMs: 15000 });
