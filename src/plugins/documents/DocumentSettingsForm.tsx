"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { saveDocumentSettingsAction } from "./server-actions";

/** Documents' settings: the command that turns audio into text, and whether Poppler is installed by itself. */
export function DocumentSettingsForm({ settings }: { settings: { transcriber: string; autoInstall: boolean } }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [command, setCommand] = useState(settings.transcriber);
  const [autoInstall, setAutoInstall] = useState(settings.autoInstall);
  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
    if (r?.ok) router.refresh();
  };
  return (
    <section id="settings" className="card space-y-2 p-4 text-sm">
      <h2 className="font-medium">{t("Audio transcriber")}</h2>
      <p className="text-xs text-zinc-500">
        {t("Audio is turned into text by a command you set — Zeff installs nothing. {file} is the recording, {dir} a folder for its output (it takes the .txt written there, else what the command prints). For example with OpenAI's Whisper:")}
      </p>
      <code className="block rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">whisper &quot;{"{file}"}&quot; --model small --output_format txt --output_dir &quot;{"{dir}"}&quot;</code>
      <label className="flex items-start gap-2 pt-1">
        <input type="checkbox" className="mt-0.5" checked={autoInstall} onChange={(e) => setAutoInstall(e.target.checked)} />
        <span>
          {t("Install Poppler by itself when a scanned or complex PDF needs it")}
          <span className="block text-xs text-zinc-500">{t("Poppler (pdftoppm) is what lets the Claude CLI read such PDFs. Zeff installs it once, with your package manager (winget or scoop on Windows, Homebrew on a Mac); if that fails it says so and tries again only when you click “Read again”.")}</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1 basis-80 font-mono text-xs" aria-label={t("Audio transcriber")} value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("(none — audio isn't read)")} />
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => done(await saveDocumentSettingsAction({ transcriber: command, autoInstall })))}>
          {t("Save")}
        </button>
      </div>
    </section>
  );
}
