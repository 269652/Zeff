import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { workReports } from "@/db/schema";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { todoRef } from "@/lib/todos/shared";
import { formatSmart } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { backfillReports, reportsForTodo } from "@/lib/work/report";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Reports") };
}

/** The workers' reports (Work): the latest, or those filed under one todo (?todo=23) — the ones it worked on and the ones that reported it done. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ todo?: string }> }) {
  await connection();
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  backfillReports();
  const todo = Number(String((await searchParams).todo ?? "").replace(/^t-?/i, ""));
  const reports = Number.isInteger(todo) && todo > 0 ? reportsForTodo(todo) : getDb().select().from(workReports).orderBy(desc(workReports.createdAt)).limit(100).all();
  return (
    <div className="page space-y-3">
      <h1 className="text-lg font-semibold">{Number.isInteger(todo) && todo > 0 ? t("Reports for {todo}", { todo: todoRef(todo) }) : t("Reports")}</h1>
      <p className="text-sm text-zinc-500">{t("What the workers report when they finish — whole, kept apart from the comment on the todo, and compiled by the knowledge server.")}</p>
      {!reports.length && <p className="text-sm text-zinc-500">{t("No reports yet.")}</p>}
      <ul className="space-y-2">
        {reports.map((r) => (
          <li key={r.id} className="card p-3 text-sm">
            <Link href={`/reports/${r.id}`} className="font-medium hover:underline">
              {r.title}
            </Link>
            <div className="text-xs text-zinc-500">
              {r.outcome} · {todoRef(r.todoId)}
              {r.ticket ? ` · ${r.ticket}` : ""} · {r.byWho} · {formatSmart(r.createdAt)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
