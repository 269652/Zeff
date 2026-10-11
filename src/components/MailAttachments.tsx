"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { answerAttachmentOfferAction, fetchAttachmentsNowAction, saveAttachmentSettingsAction } from "@/app/mail-attachment-actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { BLOCKED_EXTENSIONS, SOURCE_QUIET, type AttachmentSettings, type AttachmentSource } from "@/lib/mail/attachment-rules";

const SOURCE_LABELS: Record<AttachmentSource, string> = { outlook: "Outlook", gmail: "Gmail" };

/** The one-time opt-in notice — a compact card on the Messages and Documents pages, there until answered. */
export function MailAttachmentsOffer() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const answer = (a: "on" | "later") =>
    start(async () => {
      const r = await answerAttachmentOfferAction(a);
      if (!r?.ok) return toast(r?.error ?? t("That didn't work."), { tone: "error" });
      // “Turn on” opens its settings.
      if (a === "on") router.push("/mail#attachments");
      router.refresh();
    });
  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 text-sm" role="note">
      <p className="min-w-0 flex-1 basis-80 text-zinc-600 dark:text-zinc-300">
        <span className="font-medium text-zinc-800 dark:text-zinc-100">{t("Mail attachments → Documents?")}</span>{" "}
        {t("Zeff can take the attachments of your mails into the Documents store — searchable, compiled by the knowledge server, context for your todos. Off until you say so.")}
      </p>
      <span className="flex shrink-0 gap-2">
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer("on")}>
          {t("Turn on")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => answer("later")}>
          {t("Not now")}
        </button>
      </span>
    </div>
  );
}

/** “Fetch attachments now” — a button on the Messages page and in the settings. */
export function FetchAttachmentsButton({ className = "btn btn-sm" }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await fetchAttachmentsNowAction();
          toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        })
      }
    >
      {pending ? t("Fetching attachments …") : t("Fetch attachments now")}
    </button>
  );
}

const field = "input h-8 w-24 py-0 text-sm";

/** The settings of mail attachments → Documents (on the Messages page, #attachments). */
export function MailAttachmentsSettings({ settings, sources, folders, totals }: { settings: AttachmentSettings; sources: AttachmentSource[]; folders: string[]; totals: { documents: number; failed: number } }) {
  const t = useT();
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [pending, start] = useTransition();
  // Opened by its address (#attachments) — from the notice's “Turn on”, or a link.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => window.location.hash === "#attachments" && setOpen(true);
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const set = (patch: Partial<AttachmentSettings>) => setS((x) => ({ ...x, ...patch }));
  const list = (v: string) => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const [onlyFolders, setOnlyFolders] = useState(settings.onlyFolders.join(", "));
  const [onlyFrom, setOnlyFrom] = useState(settings.onlyFrom.join(", "));
  const [neverFrom, setNeverFrom] = useState(settings.neverFrom.join(", "));
  const opens = sources.some((x) => !SOURCE_QUIET[x]);
  const quiet = sources.filter((x) => SOURCE_QUIET[x]);
  const save = () =>
    start(async () => {
      const r = await saveAttachmentSettingsAction({ ...s, onlyFolders: list(onlyFolders), onlyFrom: list(onlyFrom), neverFrom: list(neverFrom) });
      toast(r?.ok ? (r.message ?? t("Saved.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  const box = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
  return (
    <details id="attachments" className="card group text-sm" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{t("Mail attachments → Documents")}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${settings.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{settings.enabled ? t("on") : t("off")}</span>
        {totals.documents > 0 && <span className="text-xs text-zinc-400">{t("{n} documents so far", { n: totals.documents })}</span>}
        <span className="ml-auto text-xs text-zinc-400 group-open:hidden">{t("Settings")}</span>
      </summary>
      <div className="space-y-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        {box(t("Take the attachments of my mails into Documents"), s.enabled, (v) => set({ enabled: v }), t("Each attachment becomes a document — read, compiled by the knowledge server, searchable. Nothing is fetched while this is off."))}
        <fieldset className="space-y-1.5 disabled:opacity-60" disabled={!s.enabled}>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-zinc-500">{t("From")}</span>
            {sources.map((x) => (
              <label key={x} className="flex items-center gap-1.5">
                <input type="checkbox" checked={s.sources[x]} onChange={(e) => set({ sources: { ...s.sources, [x]: e.target.checked } })} />
                {SOURCE_LABELS[x]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-zinc-500">{t("When")}</span>
            <select className="input h-8 w-auto py-0 text-sm" value={s.when} onChange={(e) => set({ when: e.target.value === "manual" ? "manual" : "sync" })} aria-label={t("When")}>
              <option value="sync">{t("with every mail sync")}</option>
              <option value="manual">{t("only when I click “Fetch attachments now”")}</option>
            </select>
            <FetchAttachmentsButton />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="flex items-center gap-1.5">
              {t("Mails of the last")}
              <input type="number" min={1} max={120} className={field} value={s.days} onChange={(e) => set({ days: Number(e.target.value) })} />
              {t("days")}
            </label>
            <label className="flex items-center gap-1.5">
              {t("Files up to")}
              <input type="number" min={1} max={50} className={field} value={s.maxMB} onChange={(e) => set({ maxMB: Number(e.target.value) })} />
              MB
            </label>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-zinc-500">{t("Kinds")}</span>
            {box(t("documents (Office, PDF, text)"), s.kinds.documents, (v) => set({ kinds: { ...s.kinds, documents: v } }))}
            {box(t("pictures"), s.kinds.pictures, (v) => set({ kinds: { ...s.kinds, pictures: v } }))}
            {box(t("audio"), s.kinds.audio, (v) => set({ kinds: { ...s.kinds, audio: v } }))}
            {box(t("everything else"), s.kinds.other, (v) => set({ kinds: { ...s.kinds, other: v } }))}
          </div>
          {s.kinds.pictures && (
            <label className="flex flex-wrap items-center gap-1.5">
              {t("Skip pictures smaller than")}
              <input type="number" min={0} max={5120} className={field} value={s.minPictureKB} onChange={(e) => set({ minPictureKB: Number(e.target.value) })} />
              KB
              <span className="text-xs text-zinc-500">{t("(signatures, logos, tracking pixels)")}</span>
            </label>
          )}
          <p className="text-xs text-zinc-500">
            {t("Never downloaded, whatever you set — programs, scripts and installers:")} <code>{BLOCKED_EXTENSIONS.map((e) => `.${e}`).join(" ")}</code>
          </p>
          {opens
            ? box(t("also unread mails (Outlook marks them read when they are opened — Zeff marks them unread again if it can)"), s.unread === "include", (v) => set({ unread: v ? "include" : "skip" }), t("Unread mails are your to-do signal, so they are left alone by default."))
            : null}
          {quiet.length > 0 && (
            <p className="text-xs text-zinc-500">
              {t("{sources} hand over attachments without opening the mail, so unread mails stay unread and are included.", { sources: quiet.map((x) => SOURCE_LABELS[x]).join(", ") })}
            </p>
          )}
          <label className="block">
            <span className="text-zinc-500">{t("Only these folders")}</span>
            <input className="input mt-0.5 w-full" value={onlyFolders} onChange={(e) => setOnlyFolders(e.target.value)} placeholder={folders.join(", ")} />
            <span className="text-xs text-zinc-500">{t("Names as in the folder list above, separated by commas; empty: all that are synced.")}</span>
          </label>
          <label className="block">
            <span className="text-zinc-500">{t("Only from these senders or domains")}</span>
            <input className="input mt-0.5 w-full" value={onlyFrom} onChange={(e) => setOnlyFrom(e.target.value)} placeholder="anna@example.com, example.org" />
          </label>
          <label className="block">
            <span className="text-zinc-500">{t("Never from")}</span>
            <input className="input mt-0.5 w-full" value={neverFrom} onChange={(e) => setNeverFrom(e.target.value)} placeholder="newsletter@example.com, ads.example.org" />
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-sm" disabled={pending} onClick={save}>
            {t("Save")}
          </button>
          {totals.failed > 0 && <span className="text-xs text-amber-600 dark:text-amber-400">{t("{n} attachments failed after several tries", { n: totals.failed })}</span>}
        </div>
      </div>
    </details>
  );
}
