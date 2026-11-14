"use client";

import { useEffect, useRef } from "react";
import type { Property, Row } from "../model";
import { parseWith } from "../flows/with";

/**
 * <data name="app" compute="my-plugin.fn" with="…"/> — a plugin's pure function run in the browser (its compute script, manifest
 * contributes.compute), in a hidden frame of its own: an opaque origin, no network (CSP), nothing of Zeff but what the view hands it —
 * the rows, the fields, the state, the database's extras and with=. Its answer is data.<name>, worked out again whenever one of those
 * changes, at once — as fast as the built-in views' own code: the way to a port's screen (docs/plugins/runtime-conversion.md, G).
 */

type SetData = (name: string, patch: Record<string, unknown>) => void;
type Frame = { win: Window | null; seq: number; waiting: Map<number, (r: { out?: unknown; error?: string }) => void> };

const frames = new Map<string, Promise<Frame>>();

const SHELL = (code: string) => `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"></head><body><script>
${code}
;(function(){var api=(typeof ZeffCompute!=="undefined"&&ZeffCompute)||{};
window.addEventListener("message",function(e){var m=e.data||{};if(typeof m.zeffCompute!=="number")return;
try{var fn=api[m.fn];if(typeof fn!=="function")throw new Error("no function "+m.fn+" in the compute script");
parent.postMessage({zeffComputed:m.zeffCompute,out:fn(m.input)},"*")}catch(err){parent.postMessage({zeffComputed:m.zeffCompute,error:String(err&&err.message||err)},"*")}});
parent.postMessage({zeffComputeReady:true},"*")})();
</script></body></html>`;

/** One frame per plugin, made once: its script loaded, answering every view's questions. */
function frameFor(plugin: string): Promise<Frame> {
  const had = frames.get(plugin);
  if (had) return had;
  const made = (async () => {
    const res = await fetch(`/api/ext/compute/${encodeURIComponent(plugin)}`);
    if (!res.ok) throw new Error(`No compute script for “${plugin}” (is the plugin on?).`);
    const code = await res.text();
    const el = document.createElement("iframe");
    el.setAttribute("sandbox", "allow-scripts");
    el.setAttribute("aria-hidden", "true");
    el.style.display = "none";
    const frame: Frame = { win: null, seq: 0, waiting: new Map() };
    const ready = new Promise<void>((done) => {
      window.addEventListener("message", (e) => {
        if (e.source !== el.contentWindow) return;
        const m = e.data as { zeffComputeReady?: boolean; zeffComputed?: number; out?: unknown; error?: string };
        if (m?.zeffComputeReady) return done();
        if (typeof m?.zeffComputed === "number") {
          frame.waiting.get(m.zeffComputed)?.({ out: m.out, error: m.error });
          frame.waiting.delete(m.zeffComputed);
        }
      });
    });
    el.srcdoc = SHELL(code);
    document.body.appendChild(el);
    frame.win = el.contentWindow;
    await ready;
    return frame;
  })();
  frames.set(plugin, made);
  made.catch(() => frames.delete(plugin));
  return made;
}

export function ComputeData({ a, setData, rows, props, state, extras }: { a: Record<string, string>; setData: SetData; rows: Row[]; props: Property[]; state: Record<string, string>; extras?: Record<string, unknown> }) {
  const seq = useRef(0);
  const at = a.compute.lastIndexOf(".");
  const plugin = a.compute.slice(0, at);
  const fn = a.compute.slice(at + 1);
  useEffect(() => {
    const name = a.name;
    const mine = ++seq.current;
    void frameFor(plugin).then(
      (frame) => {
        const id = ++frame.seq;
        frame.waiting.set(id, (r) => {
          if (mine !== seq.current) return;
          if (r.error) setData(name, { [`${name}_status`]: "error", [`${name}_error`]: r.error });
          else setData(name, { [name]: r.out, [`${name}_status`]: "ok", [`${name}_error`]: null });
        });
        // (what crosses into the frame is copied — rows, fields, state: data, nothing to call back with)
        frame.win?.postMessage({ zeffCompute: id, fn, input: { rows, props, state, extras: extras ?? {}, with: parseWith(a.with), now: Date.now() } }, "*");
      },
      (e: unknown) => setData(name, { [`${name}_status`]: "error", [`${name}_error`]: e instanceof Error ? e.message : String(e) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- what it depends on is listed
  }, [plugin, fn, a.name, a.with, rows, props, state, extras]);
  return null;
}
