"use client";

/* eslint-disable @next/next/no-img-element -- a picture a cell made is a data: address, not a file to optimise */
import { useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { useT } from "@/components/I18nProvider";
import { stripAnsi, type MimeBundle, type NbOutput } from "@/plugins/notebook/outputs";

/**
 * What a code cell left, as a Jupyter notebook shows it: streams (stderr in red), the value of the last expression and displays by
 * the best kind they hold — an image, HTML (in a frame that runs no script), Markdown, JSON, text — and errors with their
 * traceback. Nothing the code made is ever put into the page as HTML: it stays in the frame.
 */

const text = (v: unknown): string => (Array.isArray(v) ? v.join("") : typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v, null, 2));
const b64 = (v: unknown): string => text(v).replace(/\s+/g, "");

/** HTML a cell made, in a frame with no scripts, as tall as it is. */
function HtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(60);
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d) setH(Math.min(900, Math.max(30, d.documentElement.scrollHeight + 4)));
  };
  return (
    <iframe
      ref={ref}
      title="output"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font:13px system-ui,sans-serif;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px;text-align:right}th{background:#f1f1f1}@media(prefers-color-scheme:dark){body{color:#ddd}td,th{border-color:#555}th{background:#2a2a2a}}</style>${html}`}
      onLoad={fit}
      className="w-full rounded border-0 bg-transparent"
      style={{ height: h }}
    />
  );
}

function Bundle({ data }: { data: MimeBundle }) {
  if (data["image/png"]) return <img alt="output" className="max-w-full" src={`data:image/png;base64,${b64(data["image/png"])}`} />;
  if (data["image/jpeg"]) return <img alt="output" className="max-w-full" src={`data:image/jpeg;base64,${b64(data["image/jpeg"])}`} />;
  if (data["image/svg+xml"]) return <img alt="output" className="max-w-full" src={`data:image/svg+xml;base64,${typeof window === "undefined" ? "" : window.btoa(unescape(encodeURIComponent(text(data["image/svg+xml"]))))}`} />;
  if (data["text/html"]) return <HtmlFrame html={text(data["text/html"])} />;
  if (data["text/markdown"]) return <Markdown text={text(data["text/markdown"])} />;
  if (data["text/latex"]) return <pre className="whitespace-pre-wrap font-mono text-xs">{text(data["text/latex"])}</pre>;
  if (data["application/json"] !== undefined && !data["text/plain"]) return <pre className="whitespace-pre-wrap font-mono text-xs">{text(data["application/json"])}</pre>;
  return <pre className="whitespace-pre-wrap font-mono text-xs">{text(data["text/plain"])}</pre>;
}

export function CellOutputs({ outputs }: { outputs: NbOutput[] }) {
  const t = useT();
  if (!outputs.length) return null;
  return (
    <div className="space-y-1 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
      {outputs.map((o, i) => {
        if (o.output_type === "stream") return <pre key={i} className={`whitespace-pre-wrap font-mono text-xs ${o.name === "stderr" ? "text-red-600 dark:text-red-400" : ""}`}>{o.text}</pre>;
        if (o.output_type === "error")
          return (
            <div key={i} className="rounded border border-red-200 bg-red-50/60 p-2 dark:border-red-900 dark:bg-red-950/20">
              <p className="font-mono text-xs font-semibold text-red-700 dark:text-red-300">{`${o.ename}${o.evalue ? `: ${o.evalue}` : ""}`}</p>
              {o.traceback.length > 0 && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-700/80 dark:text-red-300/80">{stripAnsi(o.traceback.join("\n"))}</pre>}
            </div>
          );
        return (
          <div key={i} className="min-w-0" title={o.output_type === "execute_result" ? t("The value of the last line") : undefined}>
            <Bundle data={o.data} />
          </div>
        );
      })}
    </div>
  );
}
