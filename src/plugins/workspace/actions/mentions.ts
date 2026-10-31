"use server";

import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { DocRef } from "../doc";
import { kindIcon } from "../model";
import * as store from "../store";
import { guard } from "./shared";

// ---------------------------------------------------------------------------
// Mentions: people, pages, todos, tickets
// ---------------------------------------------------------------------------

export type MentionItem = { kind: DocRef["kind"]; ref: string; label: string; hint: string; icon: string; href: string };

/** What the @ menu offers for some letters: Kennzahlen, people, pages, todos, tickets. */
export async function mentionSearchAction(q: string): Promise<MentionItem[]> {
  try {
    guard();
    const w = String(q ?? "").trim();
    const items: MentionItem[] = [];
    // Kennzahlen: by their name (shown with their value now).
    if (w) {
      const { formatMetric, listMetrics } = await import("../metrics");
      const lw = w.toLowerCase();
      for (const m of listMetrics().filter((x) => x.label.toLowerCase().includes(lw)).slice(0, 4))
        items.push({ kind: "metric", ref: m.key, label: m.label, hint: `${t("Metric")} · ${formatMetric(m.value, m.unit)}`, icon: "📊", href: `/workspace/metrics#${m.key}` });
    }
    for (const p of store.suggestPages(w, 6)) items.push({ kind: "page", ref: String(p.id), label: p.title || t("Untitled"), hint: p.kind === "database" ? t("Database") : p.kind === "form" ? t("Form") : t("Page"), icon: p.icon || kindIcon(p.kind), href: `/workspace/${p.id}` });
    if (isInstalled("people")) {
      // The circles (Familie, Freunde, Arbeit, Behörden & Gläubiger, Dienste): a whole group at once — Schulden(@Freunde).
      for (const c of (await import("@/plugins/people/formulas")).circlesFor(w)) items.push({ kind: "circle", ref: c.key, label: c.label, hint: c.count === 1 ? t("Circle · 1 person") : t("Circle · {n} people", { n: c.count }), icon: "👥", href: "" });
      const { searchPeopleAction } = await import("@/plugins/people/server-actions");
      for (const p of await searchPeopleAction(w)) items.push({ kind: "person", ref: String(p.id), label: p.name, hint: t("Person"), icon: "👤", href: (await import("../people-database")).personHref(p.id) });
    }
    if (isInstalled("todos")) {
      const { searchTodos } = await import("@/lib/todos/store");
      if (w) for (const x of searchTodos(w, 5)) items.push({ kind: "todo", ref: String(x.id), label: `${x.ref} ${x.text}`.slice(0, 90), hint: x.status === "done" ? t("Todo · done") : t("Todo"), icon: x.status === "done" ? "✅" : "☐", href: `/t/${x.id}` });
    }
    // Tickets: by key (any key is allowed), and the synced ones by words.
    const key = /^[A-Za-z][A-Za-z0-9]+-\d+$/.test(w) ? w.toUpperCase() : null;
    const rows = (() => {
      try {
        return getSqlite().prepare("select key, summary from jira_tickets where key like ? or summary like ? order by updated_at desc limit 5").all(`${w}%`, `%${w}%`) as { key: string; summary: string }[];
      } catch {
        return [];
      }
    })();
    const keys = new Map<string, string>(rows.map((r) => [r.key.toUpperCase(), r.summary]));
    if (key && !keys.has(key)) keys.set(key, "");
    if (keys.size && w) {
      const { getTicketCards } = await import("@/lib/jira/store");
      const cards = getTicketCards([...keys.keys()]);
      for (const [k, summary] of keys) items.push({ kind: "ticket", ref: k, label: k, hint: summary || cards[k]?.summary || t("Ticket"), icon: "🎫", href: cards[k]?.url ?? "" });
    }
    return items.slice(0, 14);
  } catch {
    return [];
  }
}

/** What a mention shows live: a todo's status, a ticket's status, a page's title and icon, a Kennzahl's value. */
export async function mentionStateAction(refs: { kind: DocRef["kind"]; ref: string }[]): Promise<Record<string, { label?: string; icon?: string; status?: string; done?: boolean; missing?: boolean; href?: string; value?: string }>> {
  const out: Record<string, { label?: string; icon?: string; status?: string; done?: boolean; missing?: boolean; href?: string; value?: string }> = {};
  try {
    guard();
    for (const r of refs.slice(0, 60)) {
      const key = `${r.kind}:${r.ref}`;
      if (r.kind === "metric") {
        const { formatMetric, getMetric } = await import("../metrics");
        const m = getMetric(r.ref);
        out[key] = m ? { label: m.label, value: m.error ? "⚠" : formatMetric(m.value, m.unit), href: `/workspace/metrics#${m.key}` } : { missing: true };
      } else if (r.kind === "page") {
        const p = store.getPage(Number(r.ref));
        out[key] = p && !p.archivedAt ? { label: p.title || t("Untitled"), icon: p.icon || kindIcon(p.kind) } : { missing: true };
      } else if (r.kind === "todo" && isInstalled("todos")) {
        const { getTodo } = await import("@/lib/todos/store");
        const x = getTodo(Number(r.ref));
        out[key] = x ? { label: `${x.ref} ${x.text}`.slice(0, 80), done: x.status === "done", status: x.status } : { missing: true };
      } else if (r.kind === "ticket") {
        const { getTicketCards } = await import("@/lib/jira/store");
        const c = getTicketCards([r.ref])[r.ref.toUpperCase()];
        out[key] = c ? { label: c.summary ? `${c.key} ${c.summary}`.slice(0, 80) : c.key, status: c.synced ? c.status : undefined, done: c.statusCategory === "done" } : {};
      } else if (r.kind === "circle" && isInstalled("people")) {
        const c = (await import("@/plugins/people/formulas")).circlesFor("").find((x) => x.key === r.ref);
        out[key] = c ? { label: c.label, icon: "👥", status: t("{n} people", { n: c.count }) } : { missing: true };
      } else if (r.kind === "person" && isInstalled("people")) {
        const { getPerson } = await import("@/plugins/people/store");
        const p = getPerson(Number(r.ref));
        out[key] = p ? { label: p.name, href: (await import("../people-database")).personHref(p.id) } : { missing: true };
      }
    }
  } catch {
    // the chips stay as they were written
  }
  return out;
}
