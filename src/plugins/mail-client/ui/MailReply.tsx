"use client";

import { confirmAction } from "@/components/confirm";
import { useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { useGrant } from "@/components/PluginFlags";
import { gmailRowChangeAction } from "@/plugins/gmail/server-actions";
import { draftRowReplyAction, rowActionAction } from "@/plugins/workspace/actions";
import { inboxDraftReplyAction, inboxGmailChangeAction, inboxReplyAction } from "@/app/mail/actions";
import { IMAP_ACCOUNT } from "@/lib/mail/shared";

/**
 * A reply to a mail: to, subject, text — written, or drafted by the AI from the conversation — opened as a draft in
 * Outlook (Gmail) to send there (Zeff's mail action: you send it yourself). Gmail, once Google holds Gmail's write access:
 * sent from here on your click (or saved in Gmail's drafts), in the mail's conversation — and the conversation archived or
 * marked unread. A mail account read over IMAP / POP3 ("E-Mail"): sent from here over its SMTP server on your click. For a Workspace row (`rowId`)
 * or a conversation of the inbox (`conv`, its newest message `mailKey`) — or, `fresh`, a new mail (no conversation; `onClose`
 * when it is sent or given up).
 */
export function MailReply({ rowId, conv, account, to: to0, subject: subject0, fresh, onClose, from }: { rowId?: number; conv?: { id: string; mailKey: string }; account: string; to: string; subject: string; fresh?: boolean; onClose?: () => void; /** A new mail: the mail account (IMAP / POP3) it goes from. */ from?: string }) {
  const t = useT();
  const [open, setOpenState] = useState(!!fresh);
  const setOpen = (v: boolean) => (setOpenState(v), !v && onClose?.());
  const [to, setTo] = useState(to0);
  const [subject, setSubject] = useState(subject0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const gmailSends = useGrant("gmail-send");
  const api = account === "Gmail" && gmailSends;
  const imap = account === IMAP_ACCOUNT;
  const draft = async () => {
    setBusy(true);
    const r = rowId != null ? await draftRowReplyAction(rowId) : await inboxDraftReplyAction({ channel: account, to: to0, subject: subject0, conv: conv?.id ?? "" });
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setBody(r.text);
    if (r.to) setTo(r.to);
    setOpen(true);
  };
  const send = async (mode?: "send" | "draft") => {
    if (mode === "send" && !confirmAction(t("Send this mail to {to} now?", { to }))) return;
    setBusy(true);
    const op = { type: account === "Gmail" ? "gmail-compose" : imap ? "imap-send" : "mail-compose", to, subject, body, ...(imap && from ? { account: from } : {}) };
    const r = rowId != null ? await rowActionAction(rowId, op, mode) : await inboxReplyAction(conv?.id ?? "", conv?.mailKey ?? "", op, mode);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    if (r.href) window.open(r.href, "_blank");
    else if (r.what) {
      toast(r.what, { tone: "ok" });
      setOpen(false);
      setBody("");
    }
  };
  const change = async (what: "archive" | "unread") => {
    setBusy(true);
    const r: { ok: boolean; message?: string; error?: string } | null = rowId != null ? await gmailRowChangeAction(rowId, what) : await inboxGmailChangeAction(conv?.id ?? "", what);
    setBusy(false);
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
  };
  const manage = api && (
    <>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void change("archive")} title={t("Out of the inbox — still in All Mail; nothing is deleted")}>
        {t("Archive")}
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void change("unread")}>
        {t("Mark unread")}
      </button>
    </>
  );
  if (!open)
    return (
      <div className="flex gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          ↩ {t("Reply")}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void draft()}>
          {busy ? "…" : `✨ ${t("Draft a reply with AI")}`}
        </button>
        {manage}
      </div>
    );
  return (
    <form
      className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800"
      data-mail-reply
      onSubmit={(e) => {
        e.preventDefault();
        void send(imap ? "send" : undefined);
      }}
    >
      <input className="input w-full text-sm" value={to} placeholder={t("To")} aria-label={t("To")} onChange={(e) => setTo(e.target.value)} />
      <input className="input w-full text-sm" value={subject} placeholder={t("Subject")} aria-label={t("Subject")} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input min-h-32 w-full text-sm" value={body} placeholder={fresh ? t("Your mail …") : t("Your reply …")} aria-label={fresh ? t("Text") : t("Reply")} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        {imap ? (
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim() || !to.trim()}>
            {t("Send")}
          </button>
        ) : api ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !body.trim() || !to.trim()} onClick={() => void send("send")}>
              {t("Send")}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy || !body.trim() || !to.trim()} onClick={() => void send("draft")}>
              {t("Save as draft in Gmail")}
            </button>
            <button type="submit" className="btn btn-sm" disabled={!body.trim()}>
              ↗ {t("Open in {app}", { app: account })}
            </button>
          </>
        ) : (
          <button type="submit" className="btn btn-primary btn-sm" disabled={!body.trim()}>
            ↗ {t("Open as a draft in {app}", { app: account })}
          </button>
        )}
        {!fresh && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void draft()}>
            {busy ? "…" : `✨ ${t("Draft with AI")}`}
          </button>
        )}
        <span className="text-xs text-zinc-500">{imap ? (fresh ? t("Sent from your mailbox.") : t("Sent from your mailbox, in this conversation.")) : api ? t("Sent from your Gmail, in this conversation.") : t("You send it there.")}</span>
        <span className="flex-1" />
        <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
