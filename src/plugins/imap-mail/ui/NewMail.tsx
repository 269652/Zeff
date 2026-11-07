"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { IMAP_ACCOUNT } from "@/lib/mail/shared";
import { MailReply } from "@/plugins/mail-client/ui/MailReply";

/** "New mail": a mail written from scratch and sent from one of the mail accounts (IMAP / POP3) — the reply's form, without a conversation. */
export function NewMail({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  if (!accounts.length) return null;
  if (!open)
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        ✉ {t("New mail")}
      </button>
    );
  return (
    <div className="card space-y-2 p-3" data-new-mail>
      {accounts.length > 1 && (
        <label className="block text-sm">
          {t("From")}
          <select className="input mt-1 w-full text-sm" value={from} onChange={(e) => setFrom(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <MailReply fresh from={from} conv={{ id: "", mailKey: "" }} account={IMAP_ACCOUNT} to="" subject="" onClose={() => setOpen(false)} />
    </div>
  );
}
