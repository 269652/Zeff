"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";

const QUEUE = "zeff.capture.queue";
type Queued = { text: string; at: number };

const load = (): Queued[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? "[]");
  } catch {
    return [];
  }
};
const save = (q: Queued[]) => {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q));
  } catch {
    // storage blocked: the note is only kept while the page is open
  }
};

async function post(text: string, files: File[]): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  fd.set("text", text);
  fd.set("from", "phone");
  for (const f of files) fd.append("files", f);
  const r = await fetch("/api/capture", { method: "POST", body: fd });
  return r.json();
}

/** Quick capture: a text box and a camera/file button. Offline, texts wait on the device and go out when the connection is back. */
export function CapturePage() {
  const t = useT();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let q = load();
      while (q.length) {
        const r = await post(q[0].text, []).catch(() => null);
        if (!r?.ok) break;
        q = q.slice(1);
        save(q);
      }
      setWaiting(q.length);
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    setWaiting(load().length);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/capture/sw", { scope: "/capture" }).catch(() => undefined);
    const kick = () => void flush();
    kick();
    window.addEventListener("online", kick);
    return () => window.removeEventListener("online", kick);
  }, [flush]);

  const send = async () => {
    if (!text.trim() && !files.length) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await post(text, files).catch(() => null);
      if (r?.ok) {
        setMsg(t("Saved."));
      } else if (!r && !files.length) {
        save([...load(), { text, at: Date.now() }]);
        setWaiting(load().length);
        setMsg(t("No connection — kept on this device, it is sent later."));
      } else {
        setMsg(r?.error ?? t("No connection — photos need one. Try again."));
        return;
      }
      setText("");
      setFiles([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-3 py-4">
      <h1 className="text-xl font-semibold">⚡ {t("Quick capture")}</h1>
      <textarea className="input" rows={8} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t("A thought, a note, a to-do …")} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn cursor-pointer">
          📷 {t("Photo / file")}
          <input type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
        </label>
        {files.map((f, i) => (
          <button key={i} type="button" className="ws-tag" title={t("Remove")} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
            {f.name} ✕
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary w-full py-3 text-base" disabled={busy} onClick={send}>
        {busy ? "…" : t("Save")}
      </button>
      {msg && <p role="status" className="text-sm text-zinc-500">{msg}</p>}
      {waiting > 0 && <p className="text-sm text-amber-600">{t("{n} waiting to be sent", { n: waiting })}</p>}
    </div>
  );
}
