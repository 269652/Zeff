"use client";

import { Editor as TiptapEditor, EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskIds, TaskItemWithId, TaskListBlock, TodoListEmbedNode } from "./task-list-node";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { useLang, useT } from "@/components/I18nProvider";
import { widgetCatalogAction, formulaCallsAction, formulaDataAction, aiTextAction, aiTodosFromPageAction, createPageAction, createTodoListAction, createTodosAction, databasesAction, pageContentAction, savePageAction, taskListsAction, treeAction, type AiMode, type TaskListInfo } from "../actions";
import { markdownToDoc } from "../doc";
import { fitAiContent, relocate, type TextBlock } from "../ai-fit";
import { embedChoices } from "../embed-picker";
import type { TreeItem } from "../store";
import { Modal } from "./kit";
import { pickFile, uploadImage } from "./kit";
import { MentionCommand } from "./mention";
import { AiBlockNode, BlockGaps, Callout, DatabaseViewNode, FlexBox, RowViewNode, ZeffModuleNode, ZeffRef } from "./nodes";
import { ZeffButton, ZeffField, ZeffRelated } from "./app-nodes";
import { ROW_BLOCKS, ZeffActivity, ZeffBelongs } from "./row-blocks";
import { ZeffTimeline } from "@/plugins/timeline/ui/node";
import { CalendarEmbedNode } from "@/plugins/calendar/ui/calendar-embed";
import { ZeffRoutine } from "./routine-node";
import { ZeffWidget } from "./widget-node";
import { ZeffApp } from "./app-widget";
import { ZeffForm, ZeffIf } from "./form-nodes";
import { PageEmbedNode } from "./page-embed";
import { SlashCommand, type SlashContext } from "./slash";
import { SheetTable, TableFormulas, tableFormulasKey } from "./table-formulas";
import { PipeResultNode, TablePipeNode } from "./pipe-nodes";
import { PanelNode } from "./panel-node";
import { CodeCellNode } from "./code-cell";
import { RunAllButton } from "./page-toolbar";
import { DataFlow } from "./data-flow-ext";
import { TableSort } from "./table-sort-ext";
import { WrapMenu } from "./wrap-menu";
import { InlineFormula } from "./inline-formula";
import { AssistCardNode, startAssist, type AiTarget } from "./assist-node";
import { AiComposer } from "./ai-composer";
import type { AiChip } from "../ai-entry";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { TableTools } from "./table-tools";
import type { FormulaData } from "../page-sheet";
import "./workspace.css";
import { kindIcon } from "../model";

const lowlight = createLowlight(common);

export type SaveState = "saved" | "saving" | "error" | "conflict";

/** Markdown typed or pasted as plain text: headings, lists, fences, tables or links over several lines. */
/** Whether the text selected is inside a block of its own (a widget, a result table, a form — shown by React, not written in the page): no formatting menu there. */
function inBlockView(): boolean {
  const n = typeof window === "undefined" ? null : window.getSelection()?.anchorNode;
  const el = n instanceof Element ? n : (n?.parentElement ?? null);
  return !!el?.closest('[contenteditable="false"]');
}

const MD_HINT = /(^:::app\b|^#{1,6} |^\s*[-*] |^\s*\d+\. |^```|^\|.+\|$|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/m;

/** The selection card's AI signs (24-unit paths, drawn at 14 px). */
const AI_ICONS: Record<"improve" | "fix" | "shorter" | "longer" | "explain", string[]> = {
  improve: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 17v4", "M17 19h4"],
  fix: ["M5 12l4 4 10-10"],
  shorter: ["M4 14h6v6", "M20 10h-6V4", "M14 10l7-7", "M3 21l7-7"],
  longer: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  explain: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
};

/** The AI's answer waiting for you: where it goes, and what was selected (to find it again if the page changed meanwhile). */
type Proposal = { markdown: string; mode: AiMode; from: number; to: number; replace: boolean; original: string };

export function Editor({ pageId, contextRowId, initial, rev, editable, smallText, onSave, dragHandles = true }: { /** The handle at the side of each top-level block (drag, add below). */ dragHandles?: boolean; pageId: number; /** The row whose data the modules of this page show (a detail view laid out on a row: the page saves, the modules are the row's). */ contextRowId?: number; initial: JSONContent; rev: number; editable: boolean; smallText: boolean; onSave?: (s: SaveState) => void }) {
  const t = useT();
  const lang = useLang();
  const langRef = useRef<string>(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const router = useRouter();
  const revRef = useRef(rev);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  // What the formulas of the page's tables need from the server (Kennzahlen, shared tables): asked once a formula is there.
  const formulaData = useRef<FormulaData | null>(null);
  const formulaAsked = useRef(false);
  /** The calls of the plugins' functions asked of the server (each once). */
  const callsAsked = useRef(new Set<string>());
  const saving = useRef(false);
  const [state, setState] = useState<SaveState>("saved");
  const [conflictRev, setConflictRev] = useState<number | null>(null);
  const conflicted = useRef(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // The selection card's AI actions as a list (one column) or a grid — kept in this browser.
  const [aiLayout, setAiLayout] = useState<"grid" | "list">(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("ws:bubble-layout") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const pickAiLayout = (v: "grid" | "list") => {
    setAiLayout(v);
    try {
      localStorage.setItem("ws:bubble-layout", v);
    } catch {
      // without storage: for this page only
    }
  };
  // The page's one ✨ entry, open: where its card or text goes, the chip it opened with.
  const [composer, setComposer] = useState<(AiTarget & { chip?: AiChip }) | null>(null);
  const openComposer = useRef<(t: AiTarget) => void>(() => {});
  useEffect(() => {
    openComposer.current = (target) => setComposer(target);
  });
  const [dbPicker, setDbPicker] = useState<{ id: number; title: string; icon: string }[] | null>(null);
  const [embedPicker, setEmbedPicker] = useState<TreeItem[] | null>(null);
  const [embedQuery, setEmbedQuery] = useState("");
  const [listPicker, setListPicker] = useState<TaskListInfo[] | null>(null);
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
        } else setProposal({ markdown: r.markdown, mode, from, to, replace: !empty && !wholePage && mode !== "continue", original: empty || wholePage ? "" : text });
      } finally {
        setAiBusy(false);
      }
    },
    [pageId, t],
  );

  /** Where the cursor is: its top-level block (the composer opened from an empty line or the slash menu), else the page. */
  const here = (): AiTarget => {
    const $from = editorRef.current?.state.selection.$from;
    return $from && $from.depth > 0 ? { at: $from.after(1), scope: "block", block: { from: $from.before(1), to: $from.after(1) } } : { at: 0, scope: "page" };
  };

  // The composer's Write about a block the cursor isn't in: the caret goes to its end (continue, as told) or its text is selected
  // (improve, shorter …) first — the cursor or selection in it stays as it is. About the page: where the cursor is.
  const writeFor = (target: AiTarget, mode: AiMode, instruction?: string) => {
    const ed = editorRef.current;
    const b = target.block;
    if (ed && b) {
      const doc = ed.state.doc;
      const end = Math.min(b.to, doc.content.size);
      const start = Math.min(b.from, end);
      const { from } = ed.state.selection;
      if (from < start || from > end) {
        const caret = mode === "continue" || mode === "custom" || mode === "summarize" || mode === "actions";
        const sel = caret ? TextSelection.near(doc.resolve(end), -1) : TextSelection.between(doc.resolve(start), doc.resolve(end));
        ed.view.dispatch(ed.state.tr.setSelection(sel));
      }
    }
    void runAi(mode, instruction);
  };

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

  // The plugins' widgets, for the slash menu (each its own item).
  const widgetsRef = useRef<{ id: string; label: string; icon: string; description: string }[]>([]);
  useEffect(() => {
    void widgetCatalogAction().then((r) => {
      if (r.ok) widgetsRef.current = r.widgets;
    });
  }, []);

  // What the slash menu items call (read when picked, so always the latest).
  const ctxRef = useRef<SlashContext | null>(null);
  useEffect(() => {
    ctxRef.current = {
    pageId,
    widgets: () => widgetsRef.current,
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
    embedPage: () => {
      setEmbedQuery("");
      void treeAction().then((r) => (r.ok ? setEmbedPicker(r.items) : toast(r.error, { tone: "error" })));
    },
    embedTodoList: () => void taskListsAction().then((r) => (r.ok ? setListPicker(r.lists) : toast(r.error, { tone: "error" }))),
    newTodoList: () => {
      void createTodoListAction(t("To-do list"), pageId).then((r) => {
        if (!r.ok) return toast(r.error, { tone: "error" });
        editorRef.current?.chain().focus().insertContent({ type: "databaseView", attrs: { dbId: r.dbId, viewId: r.viewId, title: t("To-do list") } }).run();
        router.refresh();
      });
    },
    newInlinePage: () => {
      void createPageAction({ parentId: pageId }).then((r) => {
        if (!r.ok) return toast(r.error, { tone: "error" });
        editorRef.current?.chain().focus().insertContent({ type: "pageEmbed", attrs: { pageId: r.id, title: "" } }).run();
        router.refresh();
      });
    },
    linkDatabase: () => void databasesAction().then((r) => (r.ok ? setDbPicker(r.databases) : toast(r.error, { tone: "error" }))),
    ai: (mode) => (mode === "custom" ? setComposer({ ...here(), chip: "write" }) : mode === "composer" ? setComposer(here()) : void runAi(mode)),
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
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? `${t("Heading")} ${node.attrs.level}` : t("Type '/' for blocks, '@' to mention …")), showOnlyCurrent: true, includeChildren: true }),
      // eslint-disable-next-line react-hooks/refs -- flush reads its refs when it is called (a to-do list saved), not while the editor is set up
      TaskListBlock.configure({ pageId, flush: () => flush() }),
      TaskItemWithId.configure({ nested: true }),
      TaskIds,
      TodoListEmbedNode,
      SheetTable.configure({ resizable: true }),
      // eslint-disable-next-line react-hooks/refs -- the refs are read when a formula cell is shown or the data comes, not while the editor is set up
      TableFormulas.configure({
        getData: () => formulaData.current,
        requestData: () => {
          if (formulaAsked.current) return;
          formulaAsked.current = true;
          void formulaDataAction().then((r) => {
            formulaData.current = r.ok ? { metrics: r.metrics, metricUnits: r.metricUnits, sheets: r.sheets, functions: r.functions, calls: {} } : { metrics: {}, sheets: {} };
            const ed = editorRef.current;
            if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(tableFormulasKey, true));
          });
        },
        requestCalls: (calls) => {
          const fresh = calls.filter((c) => {
            const k = `${c.name.toLowerCase()}(${JSON.stringify(c.args)})`;
            if (callsAsked.current.has(k)) return false;
            callsAsked.current.add(k);
            return true;
          });
          if (!fresh.length) return;
          void formulaCallsAction(fresh).then((r) => {
            const d = formulaData.current;
            if (!d || !r.ok) return;
            d.calls = { ...d.calls, ...r.results };
            const ed = editorRef.current;
            if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(tableFormulasKey, true));
          });
        },
        locale: () => langRef.current,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: false }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Highlight,
      Callout,
      FlexBox,
      BlockGaps,
      InlineFormula,
      ZeffRef,
      DatabaseViewNode,
      ZeffModuleNode.configure({ pageId: contextRowId ?? pageId }),
      ZeffRoutine.configure({ pageId }),
      ZeffWidget.configure({ pageId: contextRowId ?? pageId }),
      ZeffApp.configure({ pageId: contextRowId ?? pageId }),
      ZeffForm.configure({ pageId }),
      ZeffIf.configure({ pageId: contextRowId ?? pageId }),
      RowViewNode.configure({ pageId: contextRowId ?? pageId }),
      ZeffField.configure({ pageId: contextRowId ?? pageId }),
      ZeffRelated.configure({ pageId: contextRowId ?? pageId }),
      ZeffButton.configure({ pageId: contextRowId ?? pageId }),
      ...ROW_BLOCKS,
      ZeffActivity.configure({ pageId: contextRowId ?? pageId }),
      ZeffBelongs.configure({ pageId: contextRowId ?? pageId }),
      ZeffTimeline.configure({ pageId: contextRowId ?? pageId }),
      CalendarEmbedNode,
      PageEmbedNode.configure({ pageId }),
      AiBlockNode.configure({ pageId }),
      TablePipeNode,
      PipeResultNode,
      PanelNode,
      CodeCellNode.configure({ pageId }),
      TableSort.configure({ labels: { sort: t("Sort by this column"), asc: t("Sorted ascending — click for descending"), desc: t("Sorted descending — click for ascending"), locked: t("Protected table — allow editing to sort"), formulas: t("A table with formulas can't be sorted"), merged: t("A table with merged cells can't be sorted") } }),
      DataFlow.configure({ labels: { editable: t("Editable"), locked: t("Protected"), computed: t("Calculated"), result: t("Result table"), protect: t("Click to protect against editing"), unprotect: t("Click to allow editing") } }),
      // eslint-disable-next-line react-hooks/refs -- read when the shortcut is pressed, not while the editor is set up
      AssistCardNode.configure({ pageId, open: (target) => openComposer.current(target) }),
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
        // (A widget block — `:::app` — always: copied from an editor the clipboard carries HTML of the highlighted code.)
        if (text.includes("\n") && MD_HINT.test(text) && (/^:::app\b/m.test(text) || !html || !/<(p|div|span|h\d|li|table)\b/i.test(html))) {
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
    // The page's ✨ (top bar): the composer, about the whole page (a Think along card goes at the top).
    const assist = () => {
      if (editorRef.current?.isEditable) setComposer({ at: 0, scope: "page" });
    };
    window.addEventListener("ws:assist", assist);
    window.addEventListener("ws:todos", todosEv);
    window.addEventListener("ws:focus-editor", focus);
    return () => {
      window.removeEventListener("ws:assist", assist);
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

  // The AI's text put in: over the selection (found again if the page changed meanwhile — gone: nothing replaced), or below it.
  // One paragraph within one line goes in as its text — a paragraph there would split the line.
  const accept = (replaceSel: boolean) => {
    if (!proposal || !editor) return;
    const doc = editor.state.doc;
    const blocks = markdownToDoc(proposal.markdown).content as JSONContent[];
    const chain = editor.chain().focus();
    if (replaceSel && proposal.replace) {
      const lines: TextBlock[] = [];
      doc.descendants((node, pos) => {
        if (node.isTextblock) lines.push({ start: pos + 1, text: node.textContent });
        return !node.isTextblock;
      });
      const at = relocate(proposal.original, { from: proposal.from, to: proposal.to }, (a, b) => doc.textBetween(a, b, "\n"), lines);
      if (!at) return void toast(t("The selected text isn't there any more — nothing replaced."), { tone: "error" });
      const oneLine = doc.resolve(at.from).sameParent(doc.resolve(at.to));
      chain.insertContentAt(at, fitAiContent(blocks, oneLine)).run();
    } else if (proposal.mode === "continue") {
      const at = Math.min(proposal.from, doc.content.size);
      chain.insertContentAt(at, fitAiContent(blocks, doc.resolve(at).parent.isTextblock)).run();
    } else {
      // Below: after the line the selection ends in (not into it).
      const $to = doc.resolve(Math.min(proposal.to, doc.content.size));
      const after = $to.parent.isTextblock && $to.depth > 0 ? $to.after($to.depth) : $to.pos;
      chain.insertContentAt(after, blocks).run();
    }
    setProposal(null);
  };

  if (!editor) return <div className="min-h-48" aria-busy="true" />;
  return (
    <div className={`ws-editor ${smallText ? "ws-small" : ""}`}>
      {/* The sticky "Run all" of a page with code cells (not in a small editor, nor in a row's detail view). */}
      {editable && !smallText && !contextRowId && <RunAllButton editor={editor} pageId={pageId} />}
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
      {editable && dragHandles && (
        <DragHandle
          editor={editor}
          // Blocks inside a flex box or a toggle have their handle too: drag them into another box, add a block after them.
          nested
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
            <button
              type="button"
              title={t("Zeff on this block: think along, write, ask (Ctrl+Shift+Space)")}
              aria-label={t("Zeff on this block")}
              onClick={() => {
                const h = handleNode.current;
                if (h) setComposer({ at: h.pos + h.size, scope: "block", block: { from: h.pos, to: h.pos + h.size } });
              }}
            >
              ✨
            </button>
            <WrapMenu editor={editor} getHandle={() => handleNode.current} />
            <span className="ws-grip" title={t("Drag to move")} aria-hidden>
              ⠿
            </span>
          </div>
        </DragHandle>
      )}
      {editable && (
        // On an empty line, at the cursor: write there with the AI.
        <FloatingMenu editor={editor} options={{ placement: "top-start", offset: 6 }}>
          <button type="button" disabled={aiBusy} className="ws-ai-inline" title={t("Tell the AI what to write — it has what Zeff knows")} onMouseDown={(e) => e.preventDefault()} onClick={() => setComposer({ ...here(), chip: "write" })}>
            ✨ {t("Write with AI")}
          </button>
        </FloatingMenu>
      )}
      {editable && (
        <BubbleMenu editor={editor} options={{ placement: "top", offset: 8, flip: { padding: { top: 72 } }, shift: { padding: 8 } }} shouldShow={({ editor: e, state: s }) => e.isEditable && !s.selection.empty && !(s.selection instanceof NodeSelection) && !e.isActive("image") && !e.isActive("codeBlock") && !e.isActive("zeffRef") && !inBlockView()}>
          {/* A small card: formatting on top, the AI's actions below in two columns, translating last. */}
          <div className="ws-bubble ws-bubble-card">
            <div className="ws-bubble-row">
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
            </div>
            <div className="ws-bubble-ai" data-layout={aiLayout} role="group" aria-label={t("AI")}>
              {([
                ["improve", AI_ICONS.improve, t("Improve")],
                ["fix", AI_ICONS.fix, t("Spelling")],
                ["shorter", AI_ICONS.shorter, t("Shorter")],
                ["longer", AI_ICONS.longer, t("Longer")],
                ["explain", AI_ICONS.explain, t("Explain")],
              ] as [AiMode, string[], string][]).map(([mode, paths, label]) => (
                <button key={mode} type="button" disabled={aiBusy} onClick={() => void runAi(mode)}>
                  {/* One size for every sign (14 px): the gap to the name is the same 8 px for each, the names aligned. */}
                  <svg aria-hidden viewBox="0 0 24 24" width={14} height={14} className="shrink-0 text-violet-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {paths.map((d) => (
                      <path key={d} d={d} />
                    ))}
                  </svg>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="ws-bubble-row">
              <span className="px-1 text-[11px] text-zinc-500">{t("Translate")}</span>
              {([
                ["translate_de", "DE"],
                ["translate_en", "EN"],
                ["translate_es", "ES"],
              ] as [AiMode, string][]).map(([mode, label]) => (
                <button key={mode} type="button" disabled={aiBusy} title={t("Translate")} className="text-xs font-medium text-violet-700 dark:text-violet-300" onClick={() => void runAi(mode)}>
                  {label}
                </button>
              ))}
              {aiBusy && <span className="animate-pulse px-1 text-[11px] text-violet-600">…</span>}
              <span className="ml-auto flex" role="group" aria-label={t("Layout")}>
                {(
                  [
                    ["list", "☰", t("List")],
                    ["grid", "▦", t("Gallery")],
                  ] as const
                ).map(([v, icon, label]) => (
                  <button key={v} type="button" title={label} aria-label={label} data-active={aiLayout === v} className="text-xs text-zinc-500" onClick={() => pickAiLayout(v)}>
                    {icon}
                  </button>
                ))}
              </span>
            </div>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
      <TableTools editor={editor} />

      {aiBusy && <p className="mt-2 text-sm text-violet-700 dark:text-violet-300">✨ {t("The AI is working …")}</p>}
      {proposal && (
        <div className="card mt-3 space-y-2 border-violet-300 p-3 dark:border-violet-800">
          <p className="text-xs font-semibold text-violet-700 uppercase dark:text-violet-300">✨ {t("AI suggestion")}</p>
          <pre tabIndex={0} className="max-h-64 overflow-auto text-sm whitespace-pre-wrap">{proposal.markdown}</pre>
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

      {composer && (
        <AiComposer
          pageId={pageId}
          scope={composer.scope}
          chip={composer.chip}
          onClose={() => setComposer(null)}
          onThink={(wish) => {
            setComposer(null);
            if (editorRef.current) startAssist(editorRef.current, Math.min(composer.at, editorRef.current.state.doc.content.size), composer.scope, wish);
          }}
          onWrite={(mode, instruction) => {
            setComposer(null);
            writeFor(composer, mode, instruction);
          }}
        />
      )}

      {listPicker && (
        <Modal title={t("Embed a to-do list")} onClose={() => setListPicker(null)}>
          {listPicker.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("No to-do lists in your pages yet — type “/to-do list” to make one.")}</p>
          ) : (
            <ul className="space-y-0.5">
              {listPicker.map((l) => (
                <li key={l.key}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => {
                      editor.chain().focus().insertContent({ type: "todoListEmbed", attrs: { pageId: l.pageId, listId: l.listId } }).run();
                      setListPicker(null);
                    }}
                  >
                    <span>☑</span>
                    <span className="min-w-0 flex-1 truncate">{l.path}</span>
                    <span className="text-xs text-zinc-400">{l.open}/{l.total}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {embedPicker && (
        <Modal title={t("Embed page")} onClose={() => setEmbedPicker(null)}>
          <input autoFocus className="input mb-2 w-full text-sm" value={embedQuery} onChange={(e) => setEmbedQuery(e.target.value)} placeholder={t("Search pages and databases …")} aria-label={t("Search")} />
          {(() => {
            const { below, other } = embedChoices(embedPicker, pageId, embedQuery);
            const pick = (i: TreeItem) => {
              editor.chain().focus().insertContent(i.kind === "database" ? { type: "databaseView", attrs: { dbId: i.id, viewId: "", title: i.title } } : { type: "pageEmbed", attrs: { pageId: i.id, title: i.title } }).run();
              setEmbedPicker(null);
            };
            const list = (items: TreeItem[], heading?: string) =>
              items.length > 0 && (
                <div className="mb-2">
                  {heading && <p className="px-2 pb-1 text-xs font-medium text-zinc-500">{heading}</p>}
                  <ul className="space-y-0.5">
                    {items.slice(0, 60).map((i) => (
                      <li key={i.id}>
                        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => pick(i)}>
                          <span>{i.icon || kindIcon(i.kind)}</span>
                          <span className="min-w-0 flex-1 truncate">{i.title || t("Untitled")}</span>
                          {i.kind === "database" && <span className="text-xs text-zinc-400">{t("Database")}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            return (
              <div className="max-h-80 overflow-y-auto">
                {list(below, t("Below this page"))}
                {list(other, below.length ? t("Everywhere else") : undefined)}
                {!below.length && !other.length && <p className="text-sm text-zinc-500">{t("Nothing found.")}</p>}
              </div>
            );
          })()}
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
                    <input className="input flex-1 text-sm" value={x.text} aria-label={t("Todo text")} onChange={(e) => setTodos(todos.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
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
