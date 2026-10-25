import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { boundaryMatrix, EXITS, type Exit, type Flow } from "@/lib/boundaries";
import { isInstalled } from "@/plugins/state";
import { BriefingToggle } from "./BriefingToggle";
import { LabelPicker } from "./LabelPicker";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Data boundaries") };
}

/**
 * Settings → Data boundaries: every source and every Workspace database against the exits — the knowledge, the briefing,
 * agents and workers, the external AI, the web — showing what flows where today, with each row's label (open, personal,
 * secret) to change. The rules themselves are lib/boundaries'; this page only shows and sets them.
 */
export default async function BoundariesPage() {
  await connection();
  const rows = await boundaryMatrix();
  const agents = isInstalled("workspace") ? (await import("@/plugins/workspace/routines")).listRoutines().filter((r) => r.kind === "agent") : [];
  const allowed = agents.filter((r) => r.permissions.personal === true).length;
  const exitName: Record<Exit, string> = { knowledge: t("Knowledge"), briefing: t("Lage → briefing & todos"), agents: t("Agents & workers"), ai: t("External AI"), web: t("Web") };
  const exitText: Record<Exit, string> = {
    knowledge: t("Offered to your knowledge server, which reads what you pick there (Plugins → Zeff → Choose what to read). Secret is never offered — picked or not."),
    briefing: t("The Lage reads the work sources and the databases switched into it (click the cell, or Workspace → Outputs); the AI writes the briefing and the todos from it. Secret databases are left out."),
    agents: t("Workspace agents, routines and Code workers reading over Zeff's MCP. Personal data only for agents allowed “May read personal data” (and your own sessions); secret for nobody."),
    ai: t("Every AI step's prompt goes to the AI you chose (Claude, Copilot, Codex — their servers). Lines of secret sources and databases are left out of it."),
    web: t("What agents put into a web search comes from what they read: personal data only through agents allowed it, secret never."),
  };
  const cell: Record<Flow, { sign: string; text: string; cls: string }> = {
    yes: { sign: "✓", text: t("flows"), cls: "text-emerald-700 dark:text-emerald-400" },
    permission: { sign: "🔑", text: t("with permission"), cls: "text-amber-700 dark:text-amber-400" },
    off: { sign: "–", text: t("switched off"), cls: "text-zinc-400" },
    no: { sign: "🔒", text: t("blocked"), cls: "text-red-700 dark:text-red-400" },
  };
  const section = (kind: "source" | "database", title: string) => {
    const list = rows.filter((r) => r.kind === kind);
    if (!list.length) return null;
    return (
      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500 uppercase dark:border-zinc-800">
              <th className="px-3 py-2 font-semibold">{title}</th>
              {kind === "database" && <th className="px-3 py-2 font-semibold">{t("From")}</th>}
              <th className="px-3 py-2 font-semibold">{t("Label")}</th>
              {EXITS.map((e) => (
                <th key={e} className="px-2 py-2 text-center font-semibold" title={exitText[e]}>
                  {exitName[e]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.map((r) => (
              <tr key={`${r.kind}:${r.key}`}>
                <td className="px-3 py-1.5">
                  {r.label !== "open" && <span aria-hidden>🔒 </span>}
                  {r.href ? (
                    <Link href={r.href} className="hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    t(r.name)
                  )}
                </td>
                {kind === "database" && <td className="px-3 py-1.5 text-xs text-zinc-500">{r.from?.length ? r.from.join(", ") : t("by hand")}</td>}
                <td className="px-3 py-1.5">
                  <LabelPicker kind={r.kind} rowKey={r.key} label={r.label} own={r.own} name={r.kind === "source" ? t(r.name) : r.name} />
                </td>
                {EXITS.map((e) => {
                  const c = cell[r.flows[e]];
                  // A database's way into the Lage: switched here (a secret one stays out).
                  if (kind === "database" && e === "briefing" && r.flows[e] !== "no")
                    return (
                      <td key={e} className="px-2 py-1.5 text-center whitespace-nowrap">
                        <BriefingToggle dbId={Number(r.key)} on={r.flows[e] === "yes"} sign={c.sign} text={c.text} cls={c.cls} />
                      </td>
                    );
                  return (
                    <td key={e} className={`px-2 py-1.5 text-center whitespace-nowrap ${c.cls}`} title={`${exitName[e]}: ${c.text}`}>
                      <span aria-hidden>{c.sign}</span> <span className="text-xs">{c.text}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/privacy" className="text-sm text-zinc-500 hover:underline">
          ← {t("What leaves this PC")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Data flows")}</h1>
        <p className="text-sm text-zinc-500">{t("What may flow where. Every source and every database has a label: open (work data — anything may read it), personal (private life — agents only with permission) or secret (it never leaves its place).")}</p>
        <p className="text-sm text-zinc-500">{t("Defaults: work sources open; WhatsApp, Signal, the bank and journal-, health- or money-like databases personal; nothing secret until you say so.")}</p>
        {isInstalled("workspace") && <p className="text-sm text-zinc-500">{t("{n} of {m} agents may read personal data.", { n: allowed, m: agents.length })}</p>}
      </div>

      <div className="space-y-4">
        <section className="card space-y-1.5 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("The exits")}</h2>
          <dl className="space-y-1">
            {EXITS.map((e) => (
              <div key={e}>
                <dt className="inline font-medium">{exitName[e]}: </dt>
                <dd className="inline text-zinc-600 dark:text-zinc-400">{exitText[e]}</dd>
              </div>
            ))}
          </dl>
        </section>
        {section("source", t("Sources"))}
        {section("database", t("Workspace databases"))}
      </div>
    </div>
  );
}
