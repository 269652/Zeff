"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSrcdoc, parseWidgetMessage, type WidgetMessage } from "@/lib/widgets/sandbox";
import { useT } from "@/components/I18nProvider";

type Bundle = { js: string[]; css: string[] };
const bundles = new Map<string, Promise<Bundle>>();

/** The libraries' code (once per set of libraries and page): the frame loads nothing itself. */
function bundleOf(libs: string[]): Promise<Bundle> {
  const key = [...new Set(libs)].sort().join(",");
  if (!key) return Promise.resolve({ js: [], css: [] });
  let p = bundles.get(key);
  if (!p) {
    p = fetch(`/api/widgets/bundle?libs=${encodeURIComponent(key)}`).then((r) => (r.ok ? (r.json() as Promise<Bundle>) : { js: [], css: [] }));
    bundles.set(key, p);
  }
  return p;
}

const isDark = () => typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || window.matchMedia?.("(prefers-color-scheme: dark)").matches);

/**
 * An interactive widget (a building block of Zeff — lib/widgets/sandbox.ts): its HTML in a sandboxed frame (scripts
 * only: no same origin, no network), as tall as its content. Results it reports come to `onResult`, checked.
 */
export function WidgetFrame({ html, libs = [], title, onResult, className = "" }: { html: string; libs?: string[]; title: string; onResult?: (r: Extract<WidgetMessage, { type: "result" }>) => void; className?: string }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(320);
  const libsKey = useMemo(() => [...new Set(libs)].sort().join(","), [libs]);
  const report = useRef(onResult);
  useEffect(() => {
    report.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let alive = true;
    void bundleOf(libsKey ? libsKey.split(",") : []).then((b) => alive && setDoc(buildSrcdoc(html, { inline: b, dark: isDark() })));
    return () => {
      alive = false;
    };
  }, [html, libsKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this frame's messages (a sandboxed frame's origin is "null": it's told by its window).
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = parseWidgetMessage(e.data);
      if (!m) return;
      if (m.type === "resize") setHeight(Math.min(m.height + 4, Math.round(window.innerHeight * 1.5)));
      else report.current?.(m);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className={`overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {doc ? (
        <iframe ref={frame} title={title} sandbox="allow-scripts" srcDoc={doc} className="block w-full border-0" style={{ height }} referrerPolicy="no-referrer" />
      ) : (
        <p className="p-4 text-sm text-zinc-500">{t("Loading the widget …")}</p>
      )}
    </div>
  );
}
