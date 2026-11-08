"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { chatSendAction } from "./actions";

/**
 * The chat's message box: a new chat (no `runId`) or the next message in one. Enter sends on a computer (Shift+Enter: a
 * new line); on a phone the send button does. `suggestions`: a few to start with, one tap each.
 */
export function ChatComposer({ runId, placeholder, suggestions = [], stay = false }: { runId?: number; placeholder?: string; suggestions?: string[]; /** Stay on this page after sending (a lesson) instead of going to the chat's. */ stay?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const send = (value = text) => {
    const v = value.trim();
    if (!v || pending) return;
    start(async () => {
      const r = await chatSendAction({ text: v, runId });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setText("");
      if (!stay) router.push(`/chat?run=${r.runId}`);
      router.refresh();
    });
  };
  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" className="btn btn-sm text-left" disabled={pending} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          {t("Message to Zeff")}
        </label>
        <textarea
          id="chat-input"
          ref={box}
          value={text}
          rows={Math.min(6, Math.max(1, text.split("\n").length))}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // On a computer Enter sends; on a touch screen it's a new line (the button sends).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder ?? t("Ask Zeff …")}
          disabled={pending}
          className="min-h-11 flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-[15px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" className="btn btn-primary min-h-11 px-4" disabled={pending || !text.trim()}>
          {pending ? t("Sending …") : t("Send")}
        </button>
      </form>
    </div>
  );
}
