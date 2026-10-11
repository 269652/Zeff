"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CLAUDE_MODES, EFFORTS, type ClaudeAsk, type ClaudeMode, type WorkRunView } from "@/lib/work/shared";
import { useT } from "../I18nProvider";
import { modeText } from "./mode-text";
import { Markdown } from "../Markdown";
import { toast } from "../Toaster";
import { EditDiff } from "./Diff";

type Post = (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; out?: string; code?: number | null }>;

/** Talk to the session over a plain request (the page refreshing meanwhile can't cancel it). */
const usePost = (runId: number): Post => (body) =>
  fetch(`/api/work/${runId}/live`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
    .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

const MODE_TONE: Partial<Record<ClaudeMode, string>> = { bypassPermissions: "bg-red-600 text-white", auto: "bg-amber-500 text-white", plan: "bg-sky-600 text-white" };

/**
 * A live Claude session's bar — Claude Code's prompt area: its mode (switch any time), model and
 * effort, stop its turn; what it asks you (a permission — with the edit or command —, its plan,
 * its questions); and your next message, with images, /commands, @files and !shell.
 */
export function ClaudeSession({ run }: { run: WorkRunView }) {
  const t = useT();
  const c = run.claude!;
  const live = run.live!;
  const post = usePost(run.id);
  const [pending, start] = useTransition();
  const act = (body: Record<string, unknown>, then?: (r: Awaited<ReturnType<Post>>) => void) =>
    start(async () => {
      const r = await post(body);
      if (!r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      else then?.(r);
    });
  const mode = (CLAUDE_MODES as readonly string[]).includes(live.mode) ? (live.mode as ClaudeMode) : "default";
  const working = live.busy && !c.asks.length;
  const status =
    c.host === "starting"
      ? c.elevated
        ? t("starting as administrator — confirm Windows' prompt (UAC)")
        : t("starting …")
      : c.host === "down"
        ? t("restarting …")
        : c.asks.length
          ? t("waits for your answer")
          : working
            ? t("working …")
            : t("waiting for you");

  return (
    <div className="space-y-2">
      {c.asks[0] && <AskCard key={c.asks[0].requestId} ask={c.asks[0]} more={c.asks.length - 1} act={act} pending={pending} allowBypass={c.allowBypass} />}

      <div className="space-y-1.5 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
          <span className={`inline-block size-2 rounded-full ${working || c.host !== "up" ? "animate-pulse bg-indigo-500" : c.asks.length ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
          <span className="text-zinc-600 dark:text-zinc-300">{status}</span>
          {c.queued > 0 && <span className="rounded bg-zinc-100 px-1.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("{n} queued", { n: c.queued })}</span>}
          {c.shellPending > 0 && (
            <span className="rounded bg-amber-100 px-1.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200" title={t("Claude Code's !: the output goes along with your next message")}>
              {t("{n} command output(s) go along with your next message", { n: c.shellPending })}
            </span>
          )}
          {c.elevated && <span className="rounded bg-red-100 px-1.5 font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{t("Administrator")}</span>}
          {working && (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act({ do: "interrupt" })} title={t("Stop its current turn (Esc)")}>
              ■ {t("Stop turn")}
            </button>
          )}
          <span className="ml-auto text-zinc-500">{c.costUsd ? `$${c.costUsd.toFixed(2)}` : ""}</span>
        </div>

        <Composer run={run} post={post} pending={pending} start={start} working={working} />

        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700" role="radiogroup" aria-label={t("Permission mode")}>
            {CLAUDE_MODES.filter((m) => m !== "bypassPermissions" || c.allowBypass).map((m) => {
              const on = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={pending || on}
                  onClick={() => act({ do: "mode", mode: m })}
                  title={modeText(t, m).hint}
                  className={`px-2 py-0.5 text-[11px] font-medium ${on ? (MODE_TONE[m] ?? "bg-indigo-600 text-white") : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
                >
                  {modeText(t, m).label}
                </button>
              );
            })}
          </span>
          <select className="input w-auto py-0.5 text-[11px]" value={c.model ?? ""} disabled={pending} onChange={(e) => act({ do: "model", model: e.target.value })} aria-label={t("Model")}>
            {!c.models.some((m) => m.value === c.model) && <option value={c.model ?? ""}>{c.model || t("Default model")}</option>}
            {c.models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            className="input w-auto py-0.5 text-[11px]"
            value={c.effort}
            disabled={pending || working}
            onChange={(e) => act({ do: "effort", effort: e.target.value })}
            aria-label={t("Effort")}
            title={t("Changing it restarts the session between turns (resumed — nothing is lost).")}
          >
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e ? t("Effort: {e}", { e }) : t("Effort: default")}
              </option>
            ))}
          </select>
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || working}
              onClick={() => act({ do: "wrap-up" })}
              title={t("It sums up and gives its result — that ends the session: its todo ticked off, the time suggested.")}
            >
              {t("Finish")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() => confirm(t("Close the session without a result? (Nothing is ticked off or booked.)")) && act({ do: "close" })}
              title={t("End it without a result")}
            >
              {t("Close")}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** The message box: Enter sends (also while it works: it waits its turn), Shift+Enter a new line, /commands, @files, !shell, images. */
function Composer({ run, post, pending, start, working }: { run: WorkRunView; post: Post; pending: boolean; start: (fn: () => Promise<void>) => void; working: boolean }) {
  const t = useT();
  const c = run.claude!;
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ mediaType: string; data: string; name: string }[]>([]);
  const [menu, setMenu] = useState<{ kind: "/" | "@"; items: { value: string; label: string; hint?: string }[]; at: number; sel: number } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const shell = text.startsWith("!");
  const draftKey = `zeff-session-draft-${run.id}`;

  // Your unsent words survive a page refresh (per session, this browser).
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- as you left it, after hydration
      if (d) setText(d);
    } catch {
      // no storage
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      // no storage
    }
  }, [draftKey, text]);

  const addFiles = async (files: FileList | File[]) => {
    for (const f of [...files]) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
        toast(t("Only images (PNG, JPEG, GIF, WebP) — for other files type @ and pick them."), { tone: "error" });
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast(t("{name} is bigger than 5 MB.", { name: f.name }), { tone: "error" });
        continue;
      }
      const data = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ""));
        r.readAsDataURL(f);
      });
      setImages((xs) => [...xs, { mediaType: f.type, data, name: f.name || "image" }].slice(0, 6));
    }
  };

  // What's typed before the cursor: a /command at the start, an @file anywhere.
  const suggest = async (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const slash = /^\/([\w:.-]*)$/.exec(before);
    if (slash) {
      const q = slash[1].toLowerCase();
      const items = c.commands
        .filter((x) => x.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
        .slice(0, 12)
        .map((x) => ({ value: `/${x.name} `, label: `/${x.name}${x.hint ? ` ${x.hint}` : ""}`, hint: x.description }));
      setMenu(items.length ? { kind: "/", items, at: 0, sel: 0 } : null);
      return;
    }
    const at = /(^|\s)@([^\s@]*)$/.exec(before);
    if (at) {
      const q = at[2];
      const r = await fetch(`/api/work/${run.id}/session?what=files&q=${encodeURIComponent(q)}`).then((x) => (x.ok ? (x.json() as Promise<{ files: string[] }>) : { files: [] }));
      const items = r.files.map((f) => ({ value: `@${f} `, label: f }));
      setMenu(items.length ? { kind: "@", items, at: caret - q.length - 1, sel: 0 } : null);
      return;
    }
    setMenu(null);
  };

  const pick = (i: number) => {
    if (!menu) return;
    const el = box.current;
    const caret = el?.selectionStart ?? text.length;
    const next = menu.kind === "/" ? menu.items[i].value + text.slice(caret) : text.slice(0, menu.at) + menu.items[i].value + text.slice(caret);
    setText(next);
    setMenu(null);
    requestAnimationFrame(() => el?.focus());
  };

  const send = () => {
    const v = text.trim();
    if (!v && !images.length) return;
    start(async () => {
      const r = shell ? await post({ do: "shell", cmd: v.slice(1).trim() }) : await post({ do: "send", text: v, images: images.map(({ mediaType, data }) => ({ mediaType, data })) });
      if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
      setText("");
      setImages([]);
      if (shell) toast(r.code ? t("Exit code {code} — the output goes along with your next message.", { code: r.code }) : t("Done — the output goes along with your next message."));
    });
  };

  return (
    <div
      className="relative"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }
      }}
    >
      {menu && (
        <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-full max-w-xl overflow-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900" role="listbox">
          {menu.items.map((x, i) => (
            <li key={x.value} role="option" aria-selected={i === menu.sel}>
              <button
                type="button"
                className={`block w-full px-2.5 py-1 text-left ${i === menu.sel ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <span className="font-mono text-xs">{x.label}</span>
                {x.hint && <span className="ml-2 truncate text-xs text-zinc-500">{x.hint.slice(0, 120)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1">
          {images.map((im, i) => (
            <span key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL preview */}
              <img src={`data:${im.mediaType};base64,${im.data}`} alt={im.name} className="h-14 w-auto rounded border border-zinc-200 dark:border-zinc-700" />
              <button type="button" className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-800 px-1 text-[10px] text-white" onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))} aria-label={t("Remove image")}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={box}
          rows={2}
          className={`block min-h-14 w-full resize-y bg-transparent px-2 py-1.5 text-sm outline-none ${shell ? "font-mono text-amber-700 dark:text-amber-300" : ""}`}
          value={text}
          disabled={pending && !working}
          placeholder={working ? t("Message — it reads it after this step (Enter)") : t("Message (Enter) · / commands · @ files · ! shell · paste images")}
          aria-label={t("Message to the session")}
          onChange={(e) => {
            setText(e.target.value);
            void suggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (menu) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setMenu({ ...menu, sel: (menu.sel + (e.key === "ArrowDown" ? 1 : menu.items.length - 1)) % menu.items.length });
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                pick(menu.sel);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(null);
                return;
              }
            }
            if (e.key === "Escape" && working) {
              e.preventDefault();
              start(async () => void (await post({ do: "interrupt" })));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <label className="btn btn-sm shrink-0 cursor-pointer" title={t("Attach images")}>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          🖼
        </label>
        <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={pending || (!text.trim() && !images.length)} onClick={send}>
          {shell ? t("Run") : working ? t("Queue") : t("Send")}
        </button>
      </div>
    </div>
  );
}

/** What it asks: a permission (with the edit or command), its plan, or questions. */
function AskCard({ ask, more, act, pending, allowBypass }: { ask: ClaudeAsk; more: number; act: (body: Record<string, unknown>) => void; pending: boolean; allowBypass: boolean }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const answer = (a: Record<string, unknown>) => act({ do: "answer", requestId: ask.requestId, answer: a });
  const i = ask.input;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");

  // Enter allows (once) while nothing else has the focus — Claude Code's quick yes.
  useEffect(() => {
    if (ask.tool === "AskUserQuestion" || ask.tool === "ExitPlanMode") return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== "Enter" || e.shiftKey || (el && /^(TEXTAREA|INPUT|SELECT|BUTTON)$/.test(el.tagName))) return;
      e.preventDefault();
      answer({ behavior: "allow" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener per ask
  }, [ask.requestId]);

  const deny = (
    <div className="space-y-1.5">
      {noting && (
        <textarea
          rows={2}
          autoFocus
          className="input w-full text-sm"
          placeholder={t("What should it do instead? (it reads this)")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
    </div>
  );

  let body: React.ReactNode;
  let buttons: React.ReactNode;
  if (ask.tool === "ExitPlanMode") {
    body = (
      <div className="max-h-[50vh] overflow-auto rounded bg-white/80 p-2 dark:bg-zinc-900/80">
        <Markdown text={s("plan") || t("(no plan text)")} />
      </div>
    );
    buttons = (
      <>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => answer({ behavior: "allow", then: "acceptEdits" })}>
          {t("Yes — accept its edits")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer({ behavior: "allow", then: "auto" })}>
          {t("Yes — in Auto")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer({ behavior: "allow", then: "default" })}>
          {t("Yes — ask me for each step")}
        </button>
        {allowBypass && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer({ behavior: "allow", then: "bypassPermissions" })}>
            {t("Yes — bypass")}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => (noting && note.trim() ? answer({ behavior: "deny", message: `Keep planning: ${note}` }) : setNoting(true))}>
          {noting ? t("Send feedback") : t("No — keep planning")}
        </button>
      </>
    );
  } else if (ask.tool === "AskUserQuestion") {
    return <Questions ask={ask} more={more} answer={answer} pending={pending} />;
  } else {
    const diff = ask.tool === "Edit" ? [{ old: s("old_string"), new: s("new_string") }] : ask.tool === "MultiEdit" && Array.isArray(i.edits) ? (i.edits as Record<string, string>[]).map((x) => ({ old: x.old_string ?? "", new: x.new_string ?? "" })) : ask.tool === "Write" ? [{ old: "", new: s("content") }] : null;
    body = (
      <div className="space-y-1.5">
        {(s("file_path") || s("notebook_path")) && <p className="font-mono text-xs break-all">{s("file_path") || s("notebook_path")}</p>}
        {diff ? (
          <div className="max-h-[45vh] space-y-1 overflow-auto">
            {diff.map((d, k) => (
              <EditDiff key={k} old={d.old} new={d.new} />
            ))}
          </div>
        ) : s("command") ? (
          <pre className="max-h-60 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-100">{s("command")}</pre>
        ) : s("url") ? (
          <p className="font-mono text-xs break-all">{s("url")}</p>
        ) : (
          <pre className="max-h-60 overflow-auto rounded bg-white/70 p-1.5 font-mono text-xs whitespace-pre-wrap dark:bg-zinc-900/70">{JSON.stringify(i, null, 2)}</pre>
        )}
        {ask.reason && ask.reason !== "This command requires approval" && <p className="text-xs text-zinc-500">{ask.reason}</p>}
      </div>
    );
    const rule = alwaysLabel(ask.suggestions, t);
    buttons = (
      <>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => answer({ behavior: "allow" })} title={t("Enter")}>
          {t("Allow")}
        </button>
        {rule && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer({ behavior: "allow", always: true })} title={t("Allow, and from now on: {rule}", { rule })}>
            {t("Always: {rule}", { rule })}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => (noting ? answer({ behavior: "deny", message: note || undefined }) : answer({ behavior: "deny" }))}>
          {noting ? t("Deny with this") : t("Deny")}
        </button>
        {!noting && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setNoting(true)}>
            {t("Deny and say why …")}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer({ behavior: "deny", interrupt: true, message: note || undefined })} title={t("Deny and stop its turn")}>
          {t("Deny & stop")}
        </button>
      </>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-sm dark:border-amber-800 dark:bg-amber-950/40" role="alertdialog" aria-label={t("It asks you")}>
      <p className="font-medium text-amber-950 dark:text-amber-100">
        {ask.tool === "ExitPlanMode" ? t("Its plan — go ahead?") : t("It wants to use {tool}", { tool: ask.tool })}
        {ask.description && ask.tool !== "ExitPlanMode" && <span className="ml-1 font-normal text-amber-900/80 dark:text-amber-200/80">— {ask.description}</span>}
        {more > 0 && <span className="ml-2 text-xs font-normal">{t("(+{n} more)", { n: more })}</span>}
      </p>
      {body}
      {deny}
      <div className="flex flex-wrap gap-1.5">{buttons}</div>
    </div>
  );
}

/** The rule "always" adds, in words. */
function alwaysLabel(suggestions: unknown[], t: ReturnType<typeof useT>): string | null {
  const parts: string[] = [];
  for (const s of suggestions as { type?: string; mode?: string; rules?: { toolName?: string; ruleContent?: string }[]; directories?: string[] }[]) {
    if (s.type === "setMode" && s.mode) parts.push(s.mode === "acceptEdits" ? t("accept edits this session") : t("mode {m}", { m: s.mode }));
    else if (s.type === "addRules") parts.push(...(s.rules ?? []).map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : (r.toolName ?? "?"))));
    else if (s.type === "addDirectories") parts.push(t("access to {d}", { d: (s.directories ?? []).join(", ") }));
  }
  return parts.length ? parts.join(", ").slice(0, 80) : null;
}

/** AskUserQuestion: each question's options (one, or several), or your own answer. */
function Questions({ ask, more, answer, pending }: { ask: ClaudeAsk; more: number; answer: (a: Record<string, unknown>) => void; pending: boolean }) {
  const t = useT();
  const qs = (ask.input.questions as { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] }[] | undefined) ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const toggle = (q: string, label: string, multi: boolean) => setPicked((p) => ({ ...p, [q]: multi ? (p[q]?.includes(label) ? p[q].filter((x) => x !== label) : [...(p[q] ?? []), label]) : [label] }));
  const ready = qs.every((q) => (picked[q.question]?.length ?? 0) > 0 || other[q.question]?.trim());
  const submit = () =>
    answer({ behavior: "allow", answers: Object.fromEntries(qs.map((q) => [q.question, [...(picked[q.question] ?? []), ...(other[q.question]?.trim() ? [other[q.question].trim()] : [])].join(", ")])) });
  return (
    <div className="space-y-3 rounded-xl border border-sky-300 bg-sky-50 p-2.5 text-sm dark:border-sky-800 dark:bg-sky-950/40" role="alertdialog" aria-label={t("It asks you")}>
      {qs.map((q) => (
        <fieldset key={q.question} className="space-y-1.5">
          <legend className="font-medium">
            {q.header && <span className="mr-1.5 rounded bg-sky-200 px-1.5 text-xs dark:bg-sky-900">{q.header}</span>}
            {q.question}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {(q.options ?? []).map((o) => {
              const on = picked[q.question]?.includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={on}
                  title={o.description}
                  onClick={() => toggle(q.question, o.label, !!q.multiSelect)}
                  className={`rounded-md border px-2.5 py-1 text-left text-xs ${on ? "border-sky-600 bg-sky-600 text-white" : "border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"}`}
                >
                  <span className="font-medium">{o.label}</span>
                  {o.description && <span className={`block ${on ? "text-sky-100" : "text-zinc-500"}`}>{o.description}</span>}
                </button>
              );
            })}
          </div>
          <input className="input w-full py-1 text-xs" placeholder={t("Or your own answer …")} value={other[q.question] ?? ""} onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))} />
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-sm btn-primary" disabled={pending || !ready} onClick={submit}>
          {t("Answer")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer({ behavior: "deny", message: "The user didn't answer — decide yourself, or ask in plain words." })}>
          {t("Skip")}
        </button>
        {more > 0 && <span className="text-xs text-zinc-500">{t("(+{n} more)", { n: more })}</span>}
      </div>
    </div>
  );
}
