"use client";

import type { JSONContent } from "@tiptap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { archivePageAction, createPageAction, duplicatePageAction, exportMarkdownAction, historyAction, restoreVersionAction, savePageAction, versionAction } from "../actions";
import type { DatabaseData } from "../actions";
import { DatabaseView, RowProperties } from "./DatabaseView";
import { Editor, type SaveState } from "./Editor";
import { COVERS, coverStyle, Dropdown, EmojiPicker, MenuItem, Modal, pickFile, uploadImage } from "./kit";

export type PageViewData = {
  id: number;
  kind: "page" | "database";
  title: string;
  icon: string;
  cover: string;
  content: JSONContent;
  rev: number;
  favorite: boolean;
  fullWidth: boolean;
  smallText: boolean;
  locked: boolean;
  template: boolean;
  isRow: boolean;
  updatedAt: string;
  crumbs: { id: number; title: string; icon: string; kind: string }[];
  backlinks: { id: number; title: string; icon: string }[];
  children: { id: number; title: string; icon: string; kind: string }[];
};

/** Download text as a file. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function History({ pageId, onClose }: { pageId: number; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [versions, setVersions] = useState<{ id: number; at: string; title: string; size: number }[] | null>(null);
  const [preview, setPreview] = useState<{ id: number; markdown: string } | null>(null);
  useEffect(() => {
    void historyAction(pageId).then((r) => setVersions(r.ok ? r.versions : []));
  }, [pageId]);
  return (
    <Modal title={t("Page history")} onClose={onClose} wide>
      {versions === null ? (
        <p className="text-sm text-zinc-500">{t("Loading …")}</p>
      ) : !versions.length ? (
        <p className="text-sm text-zinc-500">{t("No earlier versions yet — one is kept every ten minutes you edit.")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${preview?.id === v.id ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  onClick={async () => {
                    const r = await versionAction(v.id);
                    if (r.ok) setPreview({ id: v.id, markdown: r.version.markdown });
                  }}
                >
                  {new Date(v.at).toLocaleString()}
                  <span className="block truncate text-xs text-zinc-500">{v.title || t("Untitled")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            {preview ? (
              <>
                <pre className="max-h-[44vh] overflow-auto rounded-md bg-zinc-50 p-2 text-sm whitespace-pre-wrap dark:bg-zinc-900">{preview.markdown || t("(empty)")}</pre>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    const r = await restoreVersionAction(preview.id);
                    if (!r.ok) return toast(r.error, { tone: "error" });
                    toast(t("Restored."), { tone: "ok" });
                    onClose();
                    router.refresh();
                    // The editor holds the old text in memory: a reload brings the restored one.
                    setTimeout(() => window.location.reload(), 300);
                  }}
                >
                  {t("Restore this version")}
                </button>
              </>
            ) : (
              <p className="text-sm text-zinc-500">{t("Choose a version to look at it.")}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function PageView({ page, row, database }: { page: PageViewData; row?: { initial: DatabaseData; dbId: number } | null; database?: DatabaseData | null }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [cover, setCover] = useState(page.cover);
  const [favorite, setFavorite] = useState(page.favorite);
  const [fullWidth, setFullWidth] = useState(page.fullWidth);
  const [smallText, setSmallText] = useState(page.smallText);
  const [locked, setLocked] = useState(page.locked);
  const [status, setStatus] = useState<SaveState>("saved");
  const [history, setHistory] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // The title grows with its text.
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  const patch = async (p: Parameters<typeof savePageAction>[1]) => {
    const r = await savePageAction(page.id, p);
    if (!r.ok) toast(r.error, { tone: "error" });
    router.refresh();
  };
  /** Pick a cover: a gradient, a picture of yours, or none. */
  const coverPicker = (close: () => void) => (
    <div className="w-64 space-y-2 p-1">
      <div className="grid grid-cols-4 gap-1.5">
        {Object.entries(COVERS).map(([k, v]) => (
          <button
            key={k}
            type="button"
            title={k}
            aria-label={k}
            className="h-8 rounded-md border border-zinc-200 dark:border-zinc-700"
            style={{ backgroundImage: v }}
            onClick={() => {
              setCover(`gradient:${k}`);
              void patch({ cover: `gradient:${k}` });
              close();
            }}
          />
        ))}
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          className="btn btn-sm flex-1"
          onClick={async () => {
            close();
            const f = await pickFile("image/*");
            if (!f) return;
            try {
              const url = await uploadImage(f);
              setCover(url);
              void patch({ cover: url });
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), { tone: "error" });
            }
          }}
        >
          {t("Upload a picture")}
        </button>
        {cover && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setCover("");
              void patch({ cover: "" });
              close();
            }}
          >
            {t("Remove")}
          </button>
        )}
      </div>
    </div>
  );

  const saveTitle = (v: string) => {
    setTitle(v);
    setStatus("saving");
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      const r = await savePageAction(page.id, { title: v });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) router.refresh();
    }, 600);
  };

  const editable = !locked;
  const width = fullWidth ? "max-w-none" : "max-w-3xl";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <nav aria-label={t("Breadcrumbs")} className="flex min-w-0 flex-wrap items-center gap-1 text-zinc-500">
          <Link href="/workspace" className="hover:underline">
            {t("Workspace")}
          </Link>
          {page.crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              ›
              <Link href={`/workspace/${c.id}`} className="max-w-40 truncate hover:underline">
                {c.icon} {c.title || t("Untitled")}
              </Link>
            </span>
          ))}
        </nav>
        <span className="flex-1" />
        <span className={`text-xs ${status === "error" || status === "conflict" ? "text-red-600" : "text-zinc-400"}`} role="status">
          {status === "saving" ? t("Saving …") : status === "error" ? t("Not saved") : status === "conflict" ? t("Conflict") : t("Saved")}
        </span>
        <button
          type="button"
          className="icon-btn text-lg"
          title={favorite ? t("Remove from favorites") : t("Add to favorites")}
          aria-pressed={favorite}
          onClick={() => {
            setFavorite(!favorite);
            void patch({ favorite: !favorite });
          }}
        >
          {favorite ? "★" : "☆"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setHistory(true)}>
          🕘 {t("History")}
        </button>
        <Dropdown label="⋯" align="right" title={t("More")} className="btn btn-sm">
          {(close) => (
            <>
              <MenuItem checked={fullWidth} onClick={() => (setFullWidth(!fullWidth), void patch({ fullWidth: !fullWidth }), close())}>
                {t("Full width")}
              </MenuItem>
              <MenuItem checked={smallText} onClick={() => (setSmallText(!smallText), void patch({ smallText: !smallText }), close())}>
                {t("Small text")}
              </MenuItem>
              <MenuItem checked={locked} onClick={() => (setLocked(!locked), void patch({ locked: !locked }), close())}>
                🔒 {t("Lock the page")}
              </MenuItem>
              {page.isRow && (
                <MenuItem checked={page.template} onClick={() => (void patch({ template: !page.template }), close())}>
                  📋 {t("Use as a template")}
                </MenuItem>
              )}
              {page.kind === "page" && (
                <MenuItem onClick={() => (close(), window.dispatchEvent(new CustomEvent("ws:todos")))}>☑️ {t("Make Zeff todos (AI)")}</MenuItem>
              )}
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await exportMarkdownAction(page.id);
                  if (r.ok) download(r.filename, r.markdown, "text/markdown;charset=utf-8");
                  else toast(r.error, { tone: "error" });
                }}
              >
                ⇩ {t("Export as Markdown")}
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  close();
                  await navigator.clipboard?.writeText(`${window.location.origin}/workspace/${page.id}`).catch(() => {});
                  toast(t("Link copied."), { tone: "ok" });
                }}
              >
                🔗 {t("Copy the link")}
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await duplicatePageAction(page.id);
                  if (r.ok) router.push(`/workspace/${r.id}`);
                  else toast(r.error, { tone: "error" });
                }}
              >
                ⧉ {t("Duplicate")}
              </MenuItem>
              <MenuItem
                danger
                onClick={async () => {
                  close();
                  if (!confirmAction(t("Move “{title}” to the trash?", { title: title || t("Untitled") }))) return;
                  const r = await archivePageAction(page.id);
                  if (!r.ok) return toast(r.error, { tone: "error" });
                  toast(t("Moved to the trash."), { tone: "ok" });
                  const up = page.crumbs[page.crumbs.length - 1];
                  router.push(up ? `/workspace/${up.id}` : "/workspace");
                }}
              >
                🗑 {t("Move to trash")}
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      {/* The cover: shown when there is one (its hover button changes it); adding one is in the title's ⋯ menu — no row of its own. */}
      {cover && (
        <div className="group/cover ws-cover relative -mx-1 overflow-hidden rounded-lg" style={coverStyle(cover)}>
          {editable && (
            <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
              <Dropdown label={t("Change cover")} className="btn btn-sm bg-white/90 dark:bg-zinc-900/90" align="right">
                {coverPicker}
              </Dropdown>
            </div>
          )}
        </div>
      )}

      <div className={`mx-auto w-full space-y-3 ${width}`}>
        <div className="flex items-start gap-2">
          {editable ? (
            <EmojiPicker
              value={icon}
              onChange={(v) => {
                setIcon(v);
                void patch({ icon: v });
              }}
            >
              <span className="text-4xl leading-none" aria-label={t("Change the icon")}>
                {icon || <span className="text-2xl text-zinc-300">☺</span>}
              </span>
            </EmojiPicker>
          ) : (
            <span className="text-4xl leading-none">{icon}</span>
          )}
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            readOnly={!editable}
            onChange={(e) => saveTitle(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("ws:focus-editor"));
              }
            }}
            placeholder={page.kind === "database" ? t("Untitled database") : t("Untitled")}
            aria-label={t("Title")}
            className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-4xl leading-tight font-bold outline-none focus:outline-none focus-visible:outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
          />
          {editable && !cover && (
            <Dropdown label="⋯" title={t("Add cover")} align="right" className="mt-2 rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              {coverPicker}
            </Dropdown>
          )}
        </div>

        {row && <RowProperties initial={row.initial} dbId={row.dbId} rowId={page.id} />}

        {page.kind === "database" ? (
          <DatabaseView initial={database ?? null} dbId={page.id} />
        ) : (
          <Editor key={page.id} pageId={page.id} initial={page.content} rev={page.rev} editable={editable} smallText={smallText} onSave={setStatus} />
        )}

        {page.kind === "page" && (
          <div className="space-y-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
            <section>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Sub-pages")}</h2>
                {editable && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("New sub-page")}
                    title={t("New sub-page")}
                    onClick={async () => {
                      const r = await createPageAction({ parentId: page.id });
                      if (r.ok) router.push(`/workspace/${r.id}`);
                      else toast(r.error, { tone: "error" });
                    }}
                  >
                    +
                  </button>
                )}
              </div>
              {page.children.length ? (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {page.children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/workspace/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <span>{c.icon || (c.kind === "database" ? "🗂️" : "📄")}</span>
                        <span className="truncate">{c.title || t("Untitled")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-400">{t("None yet.")}</p>
              )}
            </section>
            {page.backlinks.length > 0 && (
              <section>
                <h2 className="mb-1 text-xs font-semibold text-zinc-500 uppercase">{t("Linked from")}</h2>
                <ul className="flex flex-wrap gap-1.5">
                  {page.backlinks.map((b) => (
                    <li key={b.id}>
                      <Link href={`/workspace/${b.id}`} className="ws-chip" data-kind="page">
                        {b.icon || "📄"} {b.title || t("Untitled")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {history && <History pageId={page.id} onClose={() => setHistory(false)} />}
    </div>
  );
}
