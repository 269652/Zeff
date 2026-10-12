"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;
const subscribeNever = () => () => {};

/** Text in chunks of sentences (browsers cut a long utterance off after a while, so it is spoken piece by piece). */
export function chunks(text: string, max = 220): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let cur = "";
    for (const s of para.split(/(?<=[.!?…])\s+/)) {
      if ((cur + " " + s).trim().length > max && cur) {
        out.push(cur.trim());
        cur = s;
      } else cur = `${cur} ${s}`;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.flatMap((c) => (c.length <= max * 1.6 ? [c] : c.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) ?? [c]));
}

/**
 * Listen: the text read aloud by the browser's own voice (no server, nothing sent) — a button that starts, pauses and stops
 * it. For the briefing and for an article, to take the news along without looking at it. `lang` picks the voice (de, en …).
 */
export function ListenButton({ text, lang = "de", label }: { text: string | (() => string); lang?: string; label?: string }) {
  const t = useT();
  const ok = useSyncExternalStore(subscribeNever, supported, () => false);
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const run = useRef(0);

  useEffect(() => () => void (supported() && window.speechSynthesis.cancel()), []);
  if (!ok) return null;

  const stop = () => {
    run.current++;
    window.speechSynthesis.cancel();
    setState("idle");
  };
  const start = () => {
    const body = typeof text === "function" ? text() : text;
    const parts = chunks(body);
    if (!parts.length) return;
    const me = ++run.current;
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
    setState("playing");
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = 1.05;
      if (i === parts.length - 1) u.onend = () => me === run.current && setState("idle");
      u.onerror = () => me === run.current && setState("idle");
      window.speechSynthesis.speak(u);
    });
  };

  return (
    <span className="inline-flex gap-1">
      {state === "idle" ? (
        <button type="button" className="btn btn-sm" onClick={start} title={t("Read aloud with your browser's voice")}>
          🔊 {label ?? t("Listen")}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              if (state === "playing") {
                window.speechSynthesis.pause();
                setState("paused");
              } else {
                window.speechSynthesis.resume();
                setState("playing");
              }
            }}
          >
            {state === "playing" ? `⏸ ${t("Pause")}` : `▶ ${t("Resume")}`}
          </button>
          <button type="button" className="btn btn-sm" onClick={stop}>
            ⏹ {t("Stop")}
          </button>
        </>
      )}
    </span>
  );
}
