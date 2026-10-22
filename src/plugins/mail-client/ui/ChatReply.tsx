"use client";

import { useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { draftRowReplyAction, rowActionAction } from "@/plugins/workspace/actions";

/**
 * A reply in a chat (Teams, WhatsApp, Signal): written or drafted by the AI, read once more, then sent through the channel's own way
 * (as the auto-actions send). `bar`: one line under a conversation, Enter sends (Shift+Enter: a new line).
 */
export function ChatReply({ rowId, channel, chat, onSent, bar = false }: { rowId: number; channel: string; chat: string; onSent: () => void; bar?: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = text.trim();
    if (!body || !confirmAction(t("Send to “{chat}” via {channel}?", { chat, channel }))) return;
    setBusy(true);
    const op = channel === "Teams" ? { type: "teams-message", to: chat, body } : channel === "WhatsApp" ? { type: "whatsapp-message", chat, body } : { type: "signal-message", chat, body };
    const r = await rowActionAction(rowId, op);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setText("");
    toast(t("Sent."), { tone: "ok" });
    onSent();
  };
  const draft = async () => {
    setBusy(true);
    const r = await draftRowReplyAction(rowId);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setText(r.text);
  };
  const buttons = (
    <>
      <button type="button" className="btn btn-sm" disabled={busy} title={t("Draft with AI")} onClick={() => void draft()}>
        ✨
      </button>
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
        {busy ? "…" : t("Send")}
      </button>
    </>
  );
  return (
    <form
      className={`flex gap-2 border-t border-zinc-100 dark:border-zinc-800 ${bar ? "pt-2" : "pt-3"}`}
      data-chat-reply
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        className="input min-h-10 flex-1 resize-none text-sm"
        rows={bar ? 1 : 2}
        value={text}
        readOnly={busy}
        placeholder={t("Reply …")}
        aria-label={t("Reply")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (bar && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {bar ? buttons : <div className="flex flex-col gap-1">{buttons}</div>}
    </form>
  );
}
