import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SidebarFrame } from "@/components/SidebarFrame";
import { knowledgeBrowserUrl, knowledgeStatus } from "@/plugins/knowledge/client";
import { KnowledgeAdd } from "@/plugins/knowledge/KnowledgeAdd";
import { KnowledgeChat } from "@/plugins/knowledge/KnowledgeChat";
import { KnowledgeSyncButton } from "@/plugins/knowledge/KnowledgeSyncButton";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Chat" };

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

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
            <h1 className="text-lg font-semibold">Chat</h1>
            <p className="text-sm text-zinc-500">Fragen an das Wissen — Confluence und was Zeff synchronisiert hat; jede Antwort mit ihren Quellen.</p>
          </div>
          {typeof status === "string" ? (
            <p className="alert-error text-sm">{status}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {(
                [
                  ["Seiten", status.counts.pages],
                  ["Bereiche", status.counts.spaces],
                  ["Entitäten", status.counts.entities],
                  ["Beziehungen", status.counts.relations],
                ] as const
              ).map(([label, n]) => (
                <div key={label}>
                  <dt className="text-xs text-zinc-500">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                </div>
              ))}
              {status.counts.compiled < status.counts.pages && <p className="col-span-2 text-xs text-amber-700 dark:text-amber-400">{status.counts.pages - status.counts.compiled} noch nicht kompiliert</p>}
              {status.confluence && <p className="col-span-2 truncate text-xs text-zinc-500" title={status.confluence}>{status.confluence}</p>}
              {last && (
                <p className="col-span-2 text-xs text-zinc-500">
                  Zuletzt {last.kind === "sync" ? "gelesen" : "kompiliert"} {when(last.started_at)}
                  {last.ok === 0 ? " ✗" : ""}
                  {busy && " · läuft gerade"}
                </p>
              )}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {typeof status !== "string" && <KnowledgeSyncButton busy={busy} />}
            <a href={`${server}/graph`} target="_blank" rel="noreferrer" className="btn btn-sm">
              Graph ↗
            </a>
            <a href={server} target="_blank" rel="noreferrer" className="btn btn-sm">
              Wissens-Server ↗
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
