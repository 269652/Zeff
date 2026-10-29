import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { headers } from "next/headers";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SidebarFrame } from "@/components/SidebarFrame";
import { knowledgeBrowserUrl, knowledgeStatus } from "@/plugins/knowledge/client";
import { KnowledgeAdd } from "@/plugins/knowledge/KnowledgeAdd";
import { KnowledgeChat } from "@/plugins/knowledge/KnowledgeChat";
import { KnowledgeSyncButton } from "@/plugins/knowledge/KnowledgeSyncButton";
import { formatDateTime } from "@/lib/format";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Chat") };
}

/**
 * Knowledge (Knowledge plugin): ask the knowledge — the knowledge server answers from the pages
 * it compiled, citing them. The chat the whole window; beside it the server's state (pages,
 * entities, the last run), reading anew, the server itself.
 */
export default async function KnowledgePage() {
  await connection();
  if (!isInstalled("knowledge")) return <PluginNotInstalled id="knowledge" />;
  // Where your browser reaches the knowledge server (https://knowledge.zeff:1337 beside https://zeff:1337).
  const h = await headers();
  const server = knowledgeBrowserUrl(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
  const status = await knowledgeStatus().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const last = typeof status === "string" ? null : status.runs[0];
  const busy = typeof status !== "string" && (status.running.sync || status.running.compile);
  return (
    <SidebarFrame
      storageKey="zeff-knowledge-sidebar"
      sidebar={
        <>
          <div>
            <h1 className="text-lg font-semibold">{t("Chat")}</h1>
            <p className="text-sm text-zinc-500">{t("Questions to the knowledge — Confluence and what Zeff has synced; every answer with its sources.")}</p>
          </div>
          {typeof status === "string" ? (
            <p role="alert" className="alert-error text-sm">{status}</p>
          ) : (
            // (The notes under the counts are no terms: beside the list, in the same grid.)
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dl className="contents">
                {(
                  [
                    [t("Pages"), status.counts.pages],
                    [t("Spaces"), status.counts.spaces],
                    [t("Entities"), status.counts.entities],
                    [t("Relations"), status.counts.relations],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
              {status.counts.compiled < status.counts.pages && (
                <p className="col-span-2 text-xs text-amber-700 dark:text-amber-400">{t("{n} not compiled yet", { n: status.counts.pages - status.counts.compiled })}</p>
              )}
              {status.confluence && <p className="col-span-2 truncate text-xs text-zinc-500" title={status.confluence}>{status.confluence}</p>}
              {last && (
                <p className="col-span-2 text-xs text-zinc-500">
                  {last.kind === "sync" ? t("Last read {at}", { at: formatDateTime(last.started_at) }) : t("Last compiled {at}", { at: formatDateTime(last.started_at) })}
                  {last.ok === 0 ? " ✗" : ""}
                  {busy && ` · ${t("running now")}`}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {typeof status !== "string" && <KnowledgeSyncButton busy={busy} />}
            <a href={`${server}/graph`} target="_blank" rel="noreferrer" className="btn btn-sm">
              {t("Graph ↗")}
            </a>
            <a href={server} target="_blank" rel="noreferrer" className="btn btn-sm">
              {t("Knowledge server ↗")}
            </a>
          </div>
          {typeof status !== "string" && <KnowledgeAdd />}
        </>
      }
    >
      <KnowledgeChat />
    </SidebarFrame>
  );
}
