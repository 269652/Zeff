"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { uploadDocuments } from "./DocumentsApp";
import { attachDocumentAction, listDocumentsAction } from "./server-actions";
import { KIND_ICONS, sizeText, type DocView } from "./shared";

/**
 * The panel under a todo to attach documents to it: the store's documents (search, one click —
 * the abstract beside each), or new files dropped / chosen right here: kept in the store and
 * attached at once. An attached document is part of the todo's context (and of what the AI reads).
 */
export function AttachPanel({ todoId, onClose }: { todoId: number; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [docs, setDocs] = useState<DocView[] | null>(null);
  const [q, setQ] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    listDocumentsAction().then((d) => alive && setDocs(d));
    return () => {
      alive = false;
    };
  }, []);

  const attach = (d: { id: number }) =>
    start(async () => {
      const r = await attachDocumentAction(todoId, d.id);
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
      if (r?.ok) {
        router.refresh();
        onClose();
      }
    });

  const take = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await uploadDocuments(files);
      if (!r.ok || !r.documents?.length) {
        toast(r.error ?? t("That didn't work."), { tone: "error" });
        return;
      }
      for (const d of r.documents) await attachDocumentAction(todoId, d.id);
      toast(t("{n} attached — being read …", { n: r.documents.length }));
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const shown = (docs ?? []).filter((d) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()) || d.abstract.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);

  return (
    <div
      className={`mt-1.5 space-y-1.5 rounded-md border p-2 ${over ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30" : "border-zinc-200 dark:border-zinc-700"}`}
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
    >
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus className="input min-w-0 flex-1 basis-48 text-sm" aria-label={t("Search documents")} placeholder={t("Search the documents …")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t("Uploading …") : t("Upload new …")}
        </button>
        <input ref={input} type="file" multiple className="hidden" aria-hidden tabIndex={-1} onChange={(e) => void take([...(e.target.files ?? [])])} />
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <p className="text-xs text-zinc-400">{t("…or drop files on this panel. An attached document is context for this todo.")}</p>
      {docs === null ? (
        <p className="text-xs text-zinc-400">{t("Loading …")}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-zinc-400">{docs.length ? t("Nothing matches.") : t("No documents yet — upload one.")}</p>
      ) : (
        <ul className="max-h-60 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {shown.map((d) => (
            <li key={d.id} className="flex items-start gap-2 py-1.5 text-sm">
              <span aria-hidden className="mt-0.5">
                {KIND_ICONS[d.kind]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {d.name} <span className="text-xs font-normal text-zinc-400">{sizeText(d.size)}</span>
                </span>
                <span className="line-clamp-2 text-xs text-zinc-500">{d.status === "ready" ? d.abstract : d.error || t("being read …")}</span>
              </span>
              <button type="button" className="btn btn-sm shrink-0" disabled={pending} onClick={() => attach(d)}>
                {t("Attach")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
