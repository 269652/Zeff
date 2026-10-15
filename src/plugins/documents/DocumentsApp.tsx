"use client";

import { EmptyState } from "@/components/EmptyState";
import { confirmAction } from "@/components/confirm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { HoverCard } from "@/components/HoverCard";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formatDate } from "@/lib/format";
import { DocDetails, OriginLine } from "./DocBadge";
import { attachDocumentAction, deleteDocumentAction, reprocessDocumentAction, restartReadingAction, skipDocumentAction, startReadingAction } from "./server-actions";
import { DOC_KINDS, KIND_ICONS, sizeText, type DocView } from "./shared";
import { filterDocs, isDocKindFilter, type DocKindFilter, type DocSort, type DocStatusFilter } from "./list-filter";
import { TodoPicker } from "./TodoPicker";
import type { DocOrigin } from "@/lib/mail/shared";

/** Posts files to the store; the answer says what came of each. */
export async function uploadDocuments(files: File[]): Promise<{ ok: boolean; documents?: { id: number; ref: string; name: string; fresh: boolean }[]; errors?: string[]; error?: string }> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const r = await fetch("/api/documents", { method: "POST", body: fd });
  return r.json().catch(() => ({ ok: false, error: `${r.status}` }));
}

const CHIP: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  queued: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  extracting: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  unsupported: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

/**
 * The Documents app: a drop zone (files dragged in, or picked), the store's documents with their
 * state — hover one for its abstract —, the open todos to attach one to, and the transcriber setting.
 */
export function DocumentsApp({ docs, reading, origins = {}, todos, knowledge }: { docs: DocView[]; /** What is being read now / waits (the server's view). */ reading: { current: { id: number; name: string; since: number; lane: "fast" | "slow" }[]; waiting: number; idle: boolean }; origins?: Record<number, DocOrigin>; todos: { id: number; ref: string; text: string }[]; knowledge: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<DocKindFilter>("all");
  const [sort, setSort] = useState<DocSort>("newest");
  const shown = filterDocs(docs, { query, status: statusFilter, kind: kindFilter, sort });
  const filtered = query.trim() !== "" || statusFilter !== "all" || kindFilter !== "all";
  const kindNames: Record<string, string> = { text: t("Text"), office: t("Office"), pdf: t("PDF"), image: t("Image"), audio: t("Audio"), other: t("Other") };
  const waiting = docs.some((d) => d.status === "queued" || d.status === "extracting") || (knowledge && docs.some((d) => d.status === "ready" && !d.compiled));

  // While something is being read or compiled: the list refreshes itself.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  // The running time of what is being read, ticking.
  const [now, setNow] = useState(() => Date.now());
  const reads = reading.current.length;
  useEffect(() => {
    if (!reads) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [reads]);
  const clock = (since: number) => {
    const s = Math.max(0, Math.round((now - since) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
    if (r?.ok) router.refresh();
    return !!r?.ok;
  };

  const take = async (files: File[]) => {
    if (!files.length) return;
    setUploading((n) => n + files.length);
    try {
      const r = await uploadDocuments(files);
      if (!r.ok) toast(r.error ?? t("That didn't work."), { tone: "error" });
      else {
        const fresh = r.documents?.filter((d) => d.fresh).length ?? 0;
        const same = (r.documents?.length ?? 0) - fresh;
        toast([fresh ? t("{n} added — being read …", { n: fresh }) : "", same ? t("{n} already there", { n: same }) : "", ...(r.errors ?? [])].filter(Boolean).join(" · "), { tone: r.errors?.length ? "error" : "ok" });
      }
      router.refresh();
    } finally {
      setUploading((n) => n - files.length);
    }
  };

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take([...e.dataTransfer.files]);
        }}
        className={`card flex flex-col items-center gap-2 border-2 border-dashed p-8 text-center text-sm transition ${over ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/30" : "border-zinc-300 dark:border-zinc-700"}`}
      >
        <p className="text-base font-medium">{uploading ? t("Uploading {n} …", { n: uploading }) : t("Drop documents, images or audio here")}</p>
        <p className="text-xs text-zinc-500">{t("Text, Office files, PDFs, pictures, audio — Zeff reads the text out of them{knowledge}.", { knowledge: knowledge ? t(", the knowledge server compiles an abstract") : "" })}</p>
        <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>
          {t("Choose files …")}
        </button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => void take([...(e.target.files ?? [])]).then(() => (e.target.value = ""))} />
      </div>

      {(reading.current.length > 0 || reading.waiting > 0) && (
        <div className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" role="status">
          <span className="min-w-0 flex-1 basis-64">
            {reading.current.length > 0 ? (
              <>
                {t("Reading:")}{" "}
                {reading.current.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <span className="font-medium">{c.name}</span> <span className="tabular-nums text-zinc-500">({clock(c.since)})</span>
                  </span>
                ))}
                {reading.waiting > 0 && <span className="text-zinc-500"> · {t("{n} waiting", { n: reading.waiting })}</span>}
              </>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">{t("{n} waiting — nothing is being read right now.", { n: reading.waiting })}</span>
            )}
          </span>
          {reading.idle && reading.waiting > 0 && (
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => void done(await startReadingAction()))}>
              {t("Start reading")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            title={t("Stops what is being read now (it waits for “Read again”) and starts the rest afresh.")}
            onClick={() => start(async () => void done(await restartReadingAction()))}
          >
            {t("Restart reading")}
          </button>
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState variant="centered">{t("No documents yet.")}</EmptyState>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2" role="search">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search name, abstract, concepts…")} aria-label={t("Search documents")} className="input min-w-0 flex-1 basis-56" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DocStatusFilter)} className="input w-auto" aria-label={t("Status")}>
              <option value="all">{t("All statuses")}</option>
              <option value="ready">{t("Ready")}</option>
              <option value="reading">{t("Being read")}</option>
              <option value="failed">{t("Failed")}</option>
              <option value="unsupported">{t("Not readable")}</option>
            </select>
            <select value={kindFilter} onChange={(e) => isDocKindFilter(e.target.value) && setKindFilter(e.target.value)} className="input w-auto" aria-label={t("Kind")}>
              <option value="all">{t("All kinds")}</option>
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindNames[k]}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as DocSort)} className="input w-auto" aria-label={t("Sort")}>
              <option value="newest">{t("Newest")}</option>
              <option value="name">{t("Name")}</option>
              <option value="size">{t("Size")}</option>
            </select>
          </div>
          <p role="status" aria-live="polite" className="min-h-4 text-xs text-zinc-500">
            {filtered ? t("{shown} of {n} documents", { shown: shown.length, n: docs.length }) : docs.length === 1 ? t("1 document") : t("{n} documents", { n: docs.length })}
          </p>
          {shown.length === 0 ? (
            <EmptyState variant="centered">
              {t("No document matches.")}{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setKindFilter("all");
                }}
              >
                {t("Clear filters")}
              </button>
            </EmptyState>
          ) : (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {shown.map((d) => (
            <li key={d.id} id={d.ref} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <HoverCard width={440} card={<DocDetails d={d} origin={origins[d.id]} />} className="min-w-0 flex-1 basis-64">
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
                  <span aria-hidden>{KIND_ICONS[d.kind]}</span>
                  <span className="min-w-0 truncate font-medium">{d.name}</span>
                </a>
                {origins[d.id] && <OriginLine o={origins[d.id]} />}
              </HoverCard>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CHIP[d.status]}`} title={d.error || undefined}>
                {d.status === "ready" ? (knowledge ? (d.compiled ? t("compiled") : t("ready — compiling …")) : t("ready")) : d.status === "queued" ? t("waiting") : d.status === "extracting" ? t("being read …") : d.status === "unsupported" ? t("not readable") : t("failed")}
              </span>
              <span className="text-xs text-zinc-400">
                {sizeText(d.size)} · {formatDate(d.createdAt, { weekday: false })}
              </span>
              {(d.status === "unsupported" || d.status === "failed") && (
                <p className="w-full text-xs text-zinc-500">{d.error}</p>
              )}
              <span className="flex items-center gap-1">
                {todos.length > 0 && (
                  <TodoPicker todos={todos} disabled={pending} onPick={(todo) => start(async () => void done(await attachDocumentAction(todo, d.id)))} />
                )}
                {(d.status === "queued" || d.status === "extracting") && (
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => void done(await skipDocumentAction(d.id)))}>
                    {t("Skip")}
                  </button>
                )}
                {(d.status === "unsupported" || d.status === "failed") && (
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => void done(await reprocessDocumentAction(d.id)))}>
                    {t("Read again")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm text-red-600 dark:text-red-400"
                  disabled={pending}
                  onClick={() => {
                    if (confirmAction(t("Delete “{name}”?", { name: d.name }))) start(async () => void done(await deleteDocumentAction(d.id)));
                  }}
                >
                  {t("Delete")}
                </button>
              </span>
            </li>
          ))}
        </ul>
          )}
        </div>
      )}

      <p className="text-xs text-zinc-500">
        <Link href="/settings/documents" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Documents settings")}</Link> — {t("audio transcriber, PDF reading")}
      </p>
    </div>
  );
}
