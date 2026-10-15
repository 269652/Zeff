import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DocsMarkdown } from "@/components/ext/DocsMarkdown";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { todoRef } from "@/lib/boards/shared";
import { formatSmart } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { getReport } from "@/lib/work/report";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Report") };
}

/** One worker report, whole. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  const id = Number((await params).id);
  const report = Number.isInteger(id) ? getReport(id) : undefined;
  if (!report) notFound();
  return (
    <div className="page space-y-3">
      <p className="text-sm">
        <Link href={`/reports?todo=${report.todoId}`} className="text-zinc-500 hover:underline">
          ← {t("Reports for {todo}", { todo: todoRef(report.todoId) })}
        </Link>
        {" · "}
        <Link href={`/t/${report.todoId}`} className="text-zinc-500 hover:underline">
          {todoRef(report.todoId)}
        </Link>
      </p>
      <p className="text-xs text-zinc-400">
        {report.byWho} · {formatSmart(report.createdAt)}
      </p>
      <DocsMarkdown text={report.body} />
    </div>
  );
}
