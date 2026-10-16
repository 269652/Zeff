"use client";

import { Editor as TiptapEditor, EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { useLang, useT } from "@/components/I18nProvider";
import { aiTextAction, aiTodosFromPageAction, createPageAction, createTodosAction, databasesAction, pageContentAction, savePageAction, type AiMode } from "../actions";
import { markdownToDoc } from "../doc";
import { Modal } from "./kit";
import { pickFile, uploadImage } from "./kit";
import { MentionCommand } from "./mention";
import { AiBlockNode, Callout, DatabaseViewNode, ZeffModuleNode, ZeffRef } from "./nodes";
import { PageEmbedNode } from "./page-embed";
import { SlashCommand, type SlashContext } from "./slash";
import "./workspace.css";

const lowlight = createLowlight(common);

export type SaveState = "saved" | "saving" | "error" | "conflict";

/** Markdown typed or pasted as plain text: headings, lists, fences, tables or links over several lines. */
const MD_HINT = /(^#{1,6} |^\s*[-*] |^\s*\d+\. |^```|^\|.+\|$|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/m;

type Proposal = { markdown: string; mode: AiMode; from: number; to: number; replace: boolean };

export function Editor({ pageId, initial, rev, editable, smallText, onSave }: { pageId: number; initial: JSONContent; rev: number; editable: boolean; smallText: boolean; onSave?: (s: SaveState) => void }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const revRef = useRef(rev);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  const saving = useRef(false);
  const [state, setState] = useState<SaveState>("saved");
  const [conflictRev, setConflictRev] = useState<number | null>(null);
  const conflicted = useRef(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [askAi, setAskAi] = useState(false);
  const [dbPicker, setDbPicker] = useState<{ id: number; title: string; icon: string }[] | null>(null);
  const [todos, setTodos] = useState<{ text: string; ticket: string; on: boolean }[] | null>(null);
  const [todosBusy, setTodosBusy] = useState(false);
  const handleNode = useRef<{ pos: number; size: number } | null>(null);

  const report = useCallback(
    (s: SaveState) => {
      setState(s);
      onSave?.(s);
    },
    [onSave],
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- the editor lives in a ref; the callback must stay stable for the listeners
  const flush = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || !dirty.current || saving.current) return;
    saving.current = true;
    dirty.current = false;
    report("saving");
    try {
      const r = await savePageAction(pageId, { content: JSON.stringify(ed.getJSON()) }, revRef.current);
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        dirty.current = true;
        report("error");
      } else if (r.save.ok) {
        revRef.current = r.save.rev;
        report(dirty.current ? "saving" : "saved");
      } else {
        dirty.current = true;
        conflicted.current = true;
        setConflictRev(r.save.rev);
        report("conflict");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
      dirty.current = true;
      report("error");
    } finally {
      saving.current = false;
      // Typed while saving: again.
      if (dirty.current && !timer.current && editorRef.current && !conflicted.current) timer.current = setTimeout(() => ((timer.current = null), void flush()), 800);
    }
  }, [pageId, report]);

  // The assistant (the chat in the sidebar) changed this page: its text is read again - unless you are typing (then the conflict notice says it).
  useEffect(() => {
    const again = async () => {
      const ed = editorRef.current;
      if (!ed || dirty.current || saving.current) return;
      const r = await pageContentAction(pageId);
      if (!r.ok || r.rev === revRef.current || dirty.current) return;
      ed.commands.setContent(JSON.parse(r.content) as JSONContent, { emitUpdate: false });
      revRef.current = r.rev;
    };
    window.addEventListener("ws-changed", again);
    return () => window.removeEventListener("ws-changed", again);
  }, [pageId]);

  const schedule = useCallback(() => {
    dirty.current = true;
    report("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, 800);
  }, [flush, report]);

  // The AI works on the selection (replacing it) or on what is before the caret (continuing it).
  const runAi = useCallback(
    async (mode: AiMode, instruction?: string) => {
      const ed = editorRef.current;
      if (!ed) return;
      const { from, to, empty } = ed.state.selection;
      const wholePage = mode === "summarize" || mode === "actions";
      const text = wholePage ? ed.getText({ blockSeparator: "\n" }) : empty ? ed.state.doc.textBetween(Math.max(0, from - 6000), from, "\n") : ed.state.doc.textBetween(from, to, "\n");
      setAiBusy(true);
      try {
        const r = await aiTextAction({ mode, text, instruction, pageId });
        if (!r.ok) toast(r.error, { tone: "error" });
        else if (mode === "custom") {
          // "Write with AI": typed right where the cursor was (or over the selection) - Ctrl+Z takes it back.
          const size = ed.state.doc.content.size;
          const content = markdownToDoc(r.markdown).content as JSONContent[];
          const chain = ed.chain().focus();
          (empty ? chain.insertContentAt(Math.min(from, size), content) : chain.insertContentAt({ from: Math.min(from, size), to: Math.min(to, size) }, content)).run();
          toast(t("Written — Ctrl+Z undoes it."), { tone: "ok" });
        } else setProposal({ markdown: r.markdown, mode, from, to, replace: !empty && !wholePage && mode !== "continue" });
      } finally {
        setAiBusy(false);
      }
    },
    [pageId, t],
  );

  const insertImage = useCallback(async (file: File, pos?: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      const src = await uploadImage(file);
      const chain = ed.chain().focus();
      (pos !== undefined ? chain.insertContentAt(pos, { type: "image", attrs: { src, alt: file.name } }) : chain.setImage({ src, alt: file.name })).run();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    }
  }, []);

  // What the slash menu items call (read when picked, so always the latest).
  const ctxRef = useRef<SlashContext | null>(null);
  useEffect(() => {
    ctxRef.current = {
    pageId,
    t,
    lang,
    pickImage: () => void pickFile("image/*").then((f) => f && insertImage(f)),
    newSubPage: () => {
      void createPageAction({ parentId: pageId }).then((r) => {
        if (!r.ok) return toast(r.error, { tone: "error" });
        editorRef.current
          ?.chain()
          .focus()
          .insertContent([{ type: "zeffRef", attrs: { kind: "page", ref: String(r.id), label: t("Untitled"), href: `/workspace/${r.id}` } }, { type: "text", text: " " }])
          .run();
        router.refresh();
      });
    },
    newDatabase: () => {
      void createPageAction({ parentId: pageId, kind: "database", title: t("Database") }).then((r) => {
        if (!r.ok) return toast(r.error, { tone: "error" });
        editorRef.current?.chain().focus().insertContent({ type: "databaseView", attrs: { dbId: r.id, viewId: "", title: t("Database") } }).run();
        router.refresh();
      });
    },
    linkDatabase: () => void databasesAction().then((r) => (r.ok ? setDbPicker(r.databases) : toast(r.error, { tone: "error" }))),
    ai: (mode) => (mode === "custom" ? setAskAi(true) : void runAi(mode)),
    todosFromPage: () => {
      setTodosBusy(true);
      setTodos([]);
      void aiTodosFromPageAction(pageId).then((r) => {
        setTodosBusy(false);
        if (!r.ok) {
          setTodos(null);
          return toast(r.error, { tone: "error" });
        }
        setTodos(r.todos.map((x) => ({ ...x, on: true })));
      });
    },
    };
  });

  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } } }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? `${t("Heading")} ${node.attrs.level}` : t("Type '/' for blocks, '@' to mention …")), showOnlyCurrent: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: false }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Highlight,
      Callout,
      ZeffRef,
      DatabaseViewNode,
      ZeffModuleNode.configure({ pageId }),
      PageEmbedNode.configure({ pageId }),
      AiBlockNode.configure({ pageId }),
      // eslint-disable-next-line react-hooks/refs -- read when a command runs, not while rendering
      SlashCommand.configure({ getContext: () => ctxRef.current! }),
      MentionCommand.configure({ getLang: () => lang }),
    ],
    // The extensions are made once: texts and language they need come through refs/getters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initial,
    editable,
    onUpdate: () => schedule(),
    editorProps: {
      attributes: { class: "ProseMirror", "aria-label": t("Page content") },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          event.preventDefault();
          files.forEach((f) => void insertImage(f));
          return true;
        }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html") ?? "";
        // Markdown pasted as text (no formatting of its own) becomes blocks.
        if (text.includes("\n") && MD_HINT.test(text) && (!html || !/<(p|div|span|h\d|li|table)\b/i.test(html))) {
          editorRef.current?.chain().focus().insertContent(markdownToDoc(text).content as JSONContent[]).run();
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        files.forEach((f) => void insertImage(f, pos));
        return true;
      },
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  // The page's menu asks for todos; the title's Enter asks for the editor.
  useEffect(() => {
    const todosEv = () => ctxRef.current?.todosFromPage();
    const focus = () => void editorRef.current?.commands.focus("start");
    window.addEventListener("ws:todos", todosEv);
    window.addEventListener("ws:focus-editor", focus);
    return () => {
      window.removeEventListener("ws:todos", todosEv);
      window.removeEventListener("ws:focus-editor", focus);
    };
  }, []);

  // A page left (or the tab hidden) with unsaved typing: saved first.
  useEffect(() => {
    const out = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      void flush();
    };
    const vis = () => document.visibilityState === "hidden" && out();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", out);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", out);
      out();
    };
  }, [flush]);

  const accept = (replaceSel: boolean) => {
    if (!proposal || !editor) return;
    const content = markdownToDoc(proposal.markdown).content as JSONContent[];
    const chain = editor.chain().focus();
    if (replaceSel && proposal.replace) chain.insertContentAt({ from: proposal.from, to: proposal.to }, content).run();
    else chain.insertContentAt(proposal.mode === "continue" ? proposal.from : proposal.to, content).run();
    setProposal(null);
  };

  if (!editor) return <div className="min-h-48" aria-busy="true" />;
  return (
    <div className={`ws-editor ${smallText ? "ws-small" : ""}`}>
      {state === "conflict" && (
        <div role="alert" className="alert-error mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1">{t("This page was changed somewhere else (another tab, or an agent) while you were editing.")}</span>
          <button type="button" className="btn btn-sm" onClick={() => router.refresh()}>
            {t("Load their version")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              if (conflictRev !== null) revRef.current = conflictRev;
              setConflictRev(null);
              conflicted.current = false;
              dirty.current = true;
              void flush();
            }}
          >
            {t("Keep mine")}
          </button>
        </div>
      )}
      {editable && (
        <DragHandle
          editor={editor}
          onNodeChange={({ node, pos }) => {
            handleNode.current = node ? { pos, size: node.nodeSize } : null;
          }}
        >
          <div className="ws-handle">
            <button
              type="button"
              title={t("Add a block below")}
              aria-label={t("Add a block below")}
              onClick={() => {
                const h = handleNode.current;
                if (!h) return;
                const at = h.pos + h.size;
                editor
                  .chain()
                  .focus()
                  .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
                  .run();
              }}
            >
              +
            </button>
            <span className="ws-grip" title={t("Drag to move")} aria-hidden>
              ⠿
            </span>
          </div>
        </DragHandle>
      )}
      {editable && (
        // On an empty line, at the cursor: write there with the AI.
        <FloatingMenu editor={editor} options={{ placement: "top-start", offset: 6 }}>
          <button type="button" disabled={aiBusy} className="ws-ai-inline" title={t("Tell the AI what to write — it has what Zeff knows")} onMouseDown={(e) => e.preventDefault()} onClick={() => setAskAi(true)}>
            ✨ {t("Write with AI")}
          </button>
        </FloatingMenu>
      )}
      {editable && (
        <BubbleMenu editor={editor} options={{ placement: "top" }} shouldShow={({ editor: e, state: s }) => e.isEditable && !s.selection.empty && !e.isActive("image") && !e.isActive("codeBlock") && !e.isActive("zeffRef")}>
          <div className="ws-bubble">
            {[
              { k: "bold", l: "B", title: t("Bold"), run: () => editor.chain().focus().toggleBold().run(), cls: "font-bold" },
              { k: "italic", l: "I", title: t("Italic"), run: () => editor.chain().focus().toggleItalic().run(), cls: "italic" },
              { k: "underline", l: "U", title: t("Underline"), run: () => editor.chain().focus().toggleUnderline().run(), cls: "underline" },
              { k: "strike", l: "S", title: t("Strikethrough"), run: () => editor.chain().focus().toggleStrike().run(), cls: "line-through" },
              { k: "code", l: "</>", title: t("Code"), run: () => editor.chain().focus().toggleCode().run(), cls: "font-mono text-xs" },
              { k: "highlight", l: "▮", title: t("Highlight"), run: () => editor.chain().focus().toggleHighlight().run(), cls: "" },
            ].map((b) => (
              <button key={b.k} type="button" title={b.title} aria-label={b.title} data-active={editor.isActive(b.k)} className={b.cls} onClick={b.run}>
                {b.l}
              </button>
            ))}
            <button
              type="button"
              title={t("Link")}
              aria-label={t("Link")}
              data-active={editor.isActive("link")}
              onClick={() => {
                const prev = editor.getAttributes("link").href as string | undefined;
                const url = window.prompt(t("Link address"), prev ?? "https://");
                if (url === null) return;
                if (url.trim() === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
                else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
              }}
            >
              🔗
            </button>
            <span className="mx-0.5 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
            {([
              ["improve", t("Improve")],
              ["fix", t("Fix spelling")],
              ["shorter", t("Shorter")],
              ["longer", t("Longer")],
              ["explain", t("Explain")],
              ["translate_en", "EN"],
              ["translate_de", "DE"],
              ["translate_es", "ES"],
            ] as [AiMode, string][]).map(([mode, label]) => (
              <button key={mode} type="button" disabled={aiBusy} title={`✨ ${label}`} className="text-xs text-violet-700 dark:text-violet-300" onClick={() => void runAi(mode)}>
                ✨{label}
              </button>
            ))}
          </div>
        </BubbleMenu>
      )}
      {editable && (
        <div className="mb-1 flex justify-end">
          <button type="button" disabled={aiBusy} className="btn btn-sm text-violet-700 dark:text-violet-300" title={t("Tell the AI what to write — it has what Zeff knows")} onClick={() => setAskAi(true)}>
            ✨ {aiBusy ? t("The AI is working …") : t("Write with AI")}
          </button>
        </div>
      )}
      <EditorContent editor={editor} />

      {aiBusy && <p className="mt-2 text-sm text-violet-700 dark:text-violet-300">✨ {t("The AI is working …")}</p>}
      {proposal && (
        <div className="card mt-3 space-y-2 border-violet-300 p-3 dark:border-violet-800">
          <p className="text-xs font-semibold text-violet-700 uppercase dark:text-violet-300">✨ {t("AI suggestion")}</p>
          <pre className="max-h-64 overflow-auto text-sm whitespace-pre-wrap">{proposal.markdown}</pre>
          <div className="flex flex-wrap gap-2">
            {proposal.replace && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => accept(true)}>
                {t("Replace the selection")}
              </button>
            )}
            <button type="button" className={`btn btn-sm ${proposal.replace ? "" : "btn-primary"}`} onClick={() => accept(false)}>
              {proposal.mode === "continue" ? t("Insert here") : t("Insert below")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setProposal(null)}>
              {t("Discard")}
            </button>
          </div>
        </div>
      )}

      {askAi && (
        <Modal title={`✨ ${t("Write with AI")}`} onClose={() => setAskAi(false)}>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get("q") ?? "").trim();
              if (!v) return;
              setAskAi(false);
              void runAi("custom", v);
            }}
          >
            <textarea name="q" autoFocus rows={3} className="input w-full" placeholder={t("What should it write? (e.g. “An agenda for a 30-minute kickoff”)")} />
            <p className="text-xs text-zinc-500">{t("It sees the text before the cursor, or the selection — and looks through what Zeff knows: mails, tickets, Teams messages, notes, the knowledge base, your pages.")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setAskAi(false)}>
                {t("Cancel")}
              </button>
              <button className="btn btn-primary btn-sm">{t("Write")}</button>
            </div>
          </form>
        </Modal>
      )}

      {dbPicker && (
        <Modal title={t("Linked database")} onClose={() => setDbPicker(null)}>
          {dbPicker.length ? (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {dbPicker.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => {
                      editor.chain().focus().insertContent({ type: "databaseView", attrs: { dbId: d.id, viewId: "", title: d.title } }).run();
                      setDbPicker(null);
                    }}
                  >
                    <span>{d.icon || "🗂️"}</span>
                    {d.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">{t("There is no database yet — type /database to make one.")}</p>
          )}
        </Modal>
      )}

      {todos && (
        <Modal title={`☑️ ${t("Make Zeff todos")}`} onClose={() => setTodos(null)}>
          {todosBusy ? (
            <p className="text-sm text-violet-700 dark:text-violet-300">✨ {t("The AI is reading the page …")}</p>
          ) : todos.length ? (
            <div className="space-y-2">
              <ul className="space-y-1.5">
                {todos.map((x, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <input type="checkbox" className="mt-2" checked={x.on} onChange={(e) => setTodos(todos.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label={t("Make this todo")} />
                    <input className="input flex-1 text-sm" value={x.text} onChange={(e) => setTodos(todos.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
                    {x.ticket && <span className="mt-1.5 shrink-0 font-mono text-xs text-zinc-500">{x.ticket}</span>}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-sm" onClick={() => setTodos(null)}>
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    const r = await createTodosAction(todos.filter((x) => x.on), pageId);
                    toast(r.ok ? t("{n} todos made.", { n: r.made }) : r.error, { tone: r.ok ? "ok" : "error" });
                    setTodos(null);
                  }}
                >
                  {t("Make {n} todos", { n: todos.filter((x) => x.on).length })}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">{t("The AI found nothing to do on this page.")}</p>
          )}
        </Modal>
      )}
    </div>
  );
}
