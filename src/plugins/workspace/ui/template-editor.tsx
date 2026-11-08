"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { darkPage, setupMonaco } from "@/components/monaco";
import { useT } from "@/components/I18nProvider";
import type { PartMeta, ActionMeta } from "../view-template";
import { VIEW_TAGS, viewFilterNames } from "../view-template";

/**
 * A view template in the editor of VS Code: its own language (zeff-view) — tags, attributes, {{ expressions }} and {{#if}} blocks
 * highlighted; completion of the tags (a void one closes itself, the others get their end), of a tag's attributes (with its choices),
 * of the filters after |, of the names (rows, state., data., app., the database's fields) inside {{ }}; the template's errors as
 * squiggles at their lines. Ctrl+S saves.
 */

setupMonaco();

type Ctx = { fields: string[]; parts: PartMeta[]; actions: ActionMeta[] };
const current: { ctx: Ctx } = { ctx: { fields: [], parts: [], actions: [] } };
let registered = false;

function register(monaco: Monaco) {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: "zeff-view" });
  monaco.languages.setMonarchTokensProvider("zeff-view", {
    tokenizer: {
      root: [
        [/\{\{!/, "comment", "@comment"],
        [/\{\{[#/]?(if|each|else)?/, "keyword", "@mustache"],
        [/<\/?[a-zA-Z][a-zA-Z0-9]*/, "tag", "@tag"],
        [/[^<{]+/, ""],
        [/[<{]/, ""],
      ],
      comment: [[/\}\}/, "comment", "@pop"], [/./, "comment"]],
      mustache: [
        [/\}\}/, "keyword", "@pop"],
        [/\|\s*[a-zA-Z_]+/, "type"],
        [/'[^']*'|"[^"]*"/, "string"],
        [/\d+(\.\d+)?/, "number"],
        [/\b(and|or|not|true|false|null)\b/, "keyword"],
        [/[a-zA-Z_][\w.]*/, "variable"],
        [/\[[^\]]*\]/, "variable"],
        [/./, ""],
      ],
      tag: [
        [/\/?>/, "tag", "@pop"],
        [/\{\{/, "keyword", "@mustache"],
        [/[a-zA-Z_-]+(?==)/, "attribute.name"],
        [/=/, "delimiter"],
        [/"/, "attribute.value", "@dq"],
        [/'/, "attribute.value", "@sq"],
        [/[^\s>/"'=]+/, "attribute.value"],
        [/\s+/, ""],
      ],
      dq: [[/\{\{/, "keyword", "@mustache"], [/"/, "attribute.value", "@pop"], [/[^"{]+/, "attribute.value"], [/\{/, "attribute.value"]],
      sq: [[/\{\{/, "keyword", "@mustache"], [/'/, "attribute.value", "@pop"], [/[^'{]+/, "attribute.value"], [/\{/, "attribute.value"]],
    },
  });
  monaco.languages.setLanguageConfiguration("zeff-view", {
    brackets: [["<", ">"], ["{{", "}}"], ["(", ")"], ["[", "]"]],
    autoClosingPairs: [{ open: "{{", close: " }}" }, { open: '"', close: '"' }, { open: "'", close: "'" }, { open: "(", close: ")" }, { open: "[", close: "]" }],
    surroundingPairs: [{ open: '"', close: '"' }, { open: "(", close: ")" }],
  });
  monaco.languages.registerCompletionItemProvider("zeff-view", {
    triggerCharacters: ["<", " ", "|", ".", "{"],
    provideCompletionItems(model, pos) {
      const before = model.getValueInRange({ startLineNumber: Math.max(1, pos.lineNumber - 30), startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
      const word = model.getWordUntilPosition(pos);
      const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const K = monaco.languages.CompletionItemKind;
      const S = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const openMustache = before.lastIndexOf("{{") > before.lastIndexOf("}}");
      if (openMustache) {
        const inner = before.slice(before.lastIndexOf("{{") + 2);
        if (/\|\s*\w*$/.test(inner)) return { suggestions: viewFilterNames().map((f) => ({ label: f, kind: K.Function, insertText: f, range })) };
        if (/state\.\w*$/.test(inner)) return { suggestions: [...new Set([...model.getValue().matchAll(/(?:name|bind)="([\w-]+)"/g)].map((m) => m[1]))].map((s) => ({ label: s, kind: K.Variable, insertText: s, range })) };
        if (/data\.\w*$/.test(inner)) return { suggestions: [...new Set([...model.getValue().matchAll(/<data[^>]*name="([\w-]+)"|into="([\w-]+)"/g)].map((m) => m[1] ?? m[2]))].flatMap((s) => [s, `${s}_status`, `${s}_error`]).map((s) => ({ label: s, kind: K.Variable, insertText: s, range })) };
        const names = ["rows", "state.", "data.", "app.", "db.title", "now", "title", "id", "text", "this", ...current.ctx.fields.map((f) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(f) ? f : `[${f}]`))];
        return { suggestions: names.map((n) => ({ label: n, kind: n.endsWith(".") ? K.Module : K.Field, insertText: n, range })) };
      }
      // Inside a tag: its attributes.
      const tagOpen = /<([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^<>]*)?$/.exec(before);
      if (tagOpen && /\s[\w-]*$/.test(before)) {
        const def = VIEW_TAGS[tagOpen[1].toLowerCase()];
        const attrs = def ? Object.entries(def.attrs) : [];
        if (tagOpen[1].toLowerCase() === "part") return { suggestions: current.ctx.parts.map((p) => ({ label: `name="${p.name}"`, kind: K.Property, insertText: `name="${p.name}"`, documentation: p.description, range })) };
        return {
          suggestions: attrs.map(([a, kind]) => {
            const choices = typeof kind === "object" && "oneOf" in kind ? kind.oneOf : null;
            const actionList = a === "action" ? ["new", "open", "set", "toggle", "delete", "duplicate", "hide", "state", "select", "url", "print", "reload", "assistant", ...current.ctx.actions.map((x) => x.name)] : null;
            const list = choices ?? actionList;
            return { label: a, kind: K.Property, insertText: list ? `${a}="\${1|${list.join(",")}|}"` : `${a}="$1"`, insertTextRules: S, detail: typeof kind === "string" ? kind : "", range };
          }),
        };
      }
      // A tag.
      if (/<[a-zA-Z]*$/.test(before)) {
        return {
          suggestions: Object.entries(VIEW_TAGS).map(([name, def]) => ({ label: name, kind: K.Class, insertText: def.void ? `${name} $1/>` : `${name}$1>$0</${name}>`, insertTextRules: S, range })),
        };
      }
      return {
        suggestions: [
          { label: "{{#if}}", kind: K.Snippet, insertText: "{{#if ${1:state.q}}}$0{{/if}}", insertTextRules: S, range },
          { label: "{{#each}}", kind: K.Snippet, insertText: "{{#each ${1:rows}}}$0{{/each}}", insertTextRules: S, range },
          { label: "{{ }}", kind: K.Snippet, insertText: "{{ ${1:title} }}", insertTextRules: S, range },
        ],
      };
    },
  });
}

export function TemplateEditor({ value, onChange, errors, fields, parts, actions, onSave, height = "26rem" }: { value: string; onChange: (v: string) => void; errors: { line: number; message: string }[]; fields: string[]; parts: PartMeta[]; actions: ActionMeta[]; onSave: () => void; height?: string }) {
  const t = useT();
  const [dark] = useState(darkPage);
  const ed = useRef<{ monaco: Monaco; model: import("monaco-editor").editor.ITextModel } | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
    current.ctx = { fields, parts, actions };
  });
  // The template's errors as squiggles at their lines.
  useEffect(() => {
    const e = ed.current;
    if (!e) return;
    e.monaco.editor.setModelMarkers(
      e.model,
      "zeff-view",
      errors.map((x) => ({ severity: e.monaco.MarkerSeverity.Error, message: x.message, startLineNumber: x.line, endLineNumber: x.line, startColumn: 1, endColumn: e.model.getLineMaxColumn(Math.min(x.line, e.model.getLineCount())) })),
    );
  }, [errors, value]);
  const onMount: OnMount = (editor, monaco) => {
    const model = editor.getModel();
    if (model) ed.current = { monaco, model };
    // eslint-disable-next-line no-bitwise -- Monaco's key chords are bit masks
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save.current());
  };
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700" style={{ height }}>
      <Editor
        language="zeff-view"
        value={value}
        theme={dark ? "vs-dark" : "vs"}
        beforeMount={register}
        onMount={onMount}
        onChange={(v) => onChange(v ?? "")}
        options={{ fontSize: 12, minimap: { enabled: false }, wordWrap: "on", tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true, fixedOverflowWidgets: true, quickSuggestions: { other: true, strings: true, comments: false }, bracketPairColorization: { enabled: true } }}
        loading={<p className="p-3 text-sm text-zinc-500">{t("Loading the editor …")}</p>}
      />
    </div>
  );
}
