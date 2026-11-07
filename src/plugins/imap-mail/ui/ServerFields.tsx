"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { SmtpSecurity } from "../presets";

const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

type Servers = { imapHost: string; imapPort: number; imapTls: boolean; smtpHost: string; smtpPort: number; smtpSecurity: SmtpSecurity };

/** An account's servers: incoming (IMAP or POP3) and outgoing (SMTP) — the port follows the encryption picked, each stays editable. */
export function ServerFields({ method, initial }: { method: "imap" | "pop3"; initial: Servers }) {
  const t = useT();
  const [s, setS] = useState<Servers>(initial);
  const set = (p: Partial<Servers>) => setS((x) => ({ ...x, ...p }));
  const tlsPort = method === "pop3" ? 995 : 993;
  const plainPort = method === "pop3" ? 110 : 143;
  return (
    <>
      <fieldset className="grid grid-cols-[1fr_6rem_8rem] gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">{method === "pop3" ? t("Incoming mail (POP3)") : t("Incoming mail (IMAP)")}</legend>
        <label className="block text-sm">
          {t("Server")}
          <input name="imapHost" value={s.imapHost} onChange={(e) => set({ imapHost: e.target.value })} className={`${field} mt-1`} placeholder={method === "pop3" ? "pop.example.com" : "imap.example.com"} />
        </label>
        <label className="block text-sm">
          {t("Port")}
          <input name="imapPort" type="number" min={1} max={65535} value={s.imapPort} onChange={(e) => set({ imapPort: Number(e.target.value) })} className={`${field} mt-1`} />
        </label>
        <label className="block text-sm">
          {t("Encryption")}
          <select name="imapSecurity" value={s.imapTls ? "tls" : "starttls"} onChange={(e) => set({ imapTls: e.target.value === "tls", imapPort: e.target.value === "tls" ? tlsPort : plainPort })} className={`${field} mt-1`}>
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
          </select>
        </label>
      </fieldset>
      <fieldset className="grid grid-cols-[1fr_6rem_8rem] gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">{t("Outgoing mail (SMTP)")}</legend>
        <label className="block text-sm">
          {t("Server")}
          <input name="smtpHost" value={s.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} className={`${field} mt-1`} placeholder="smtp.example.com" />
        </label>
        <label className="block text-sm">
          {t("Port")}
          <input name="smtpPort" type="number" min={1} max={65535} value={s.smtpPort} onChange={(e) => set({ smtpPort: Number(e.target.value) })} className={`${field} mt-1`} />
        </label>
        <label className="block text-sm">
          {t("Encryption")}
          <select name="smtpSecurity" value={s.smtpSecurity} onChange={(e) => set({ smtpSecurity: e.target.value === "starttls" ? "starttls" : "tls", smtpPort: e.target.value === "starttls" ? 587 : 465 })} className={`${field} mt-1`}>
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
          </select>
        </label>
      </fieldset>
    </>
  );
}
