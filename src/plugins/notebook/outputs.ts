/**
 * What a cell leaves: outputs in the shape of a Jupyter notebook (nbformat 4) — a stream (stdout / stderr), a display (data by MIME
 * type: text/plain, text/html, image/png …), the value of the last expression (execute_result), an error with its traceback.
 * Pure and client-safe: the kernels' messages are turned into these, here.
 */

export type MimeBundle = Record<string, unknown>;
export type NbOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | { output_type: "display_data"; data: MimeBundle; metadata: Record<string, unknown> }
  | { output_type: "execute_result"; execution_count: number | null; data: MimeBundle; metadata: Record<string, unknown> }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

/** What a kernel says about the cell it is running (its harness: harness.ts). */
export type KernelMsg =
  | { t: "stream"; name?: string; text?: string }
  | { t: "display"; data?: MimeBundle }
  | { t: "result"; data?: MimeBundle }
  | { t: "error"; ename?: string; evalue?: string; traceback?: string[] }
  /** What the cell hands on as its output (its last expression, or a top-level return): JSON. */
  | { t: "returned"; value?: unknown };

/** At most this much output is kept for a cell (characters, images counted by their base64 text). */
export const MAX_OUTPUT_CHARS = 4_000_000;

const size = (o: NbOutput): number => (o.output_type === "stream" ? o.text.length : o.output_type === "error" ? o.traceback.join("\n").length + o.evalue.length : JSON.stringify(o.data).length);

/** A message added to the outputs; false once the cell has said more than may be kept (the rest is dropped, once, with a note). */
export function addMessage(outputs: NbOutput[], msg: KernelMsg, count: number): boolean {
  const used = outputs.reduce((n, o) => n + size(o), 0);
  if (used > MAX_OUTPUT_CHARS) {
    const last = outputs[outputs.length - 1];
    if (!(last?.output_type === "stream" && last.name === "stderr" && last.text.endsWith("[output cut off]\n"))) outputs.push({ output_type: "stream", name: "stderr", text: "\n[output cut off]\n" });
    return false;
  }
  if (msg.t === "stream") {
    const name = msg.name === "stderr" ? "stderr" : "stdout";
    const text = String(msg.text ?? "");
    const last = outputs[outputs.length - 1];
    if (last?.output_type === "stream" && last.name === name) last.text += text;
    else outputs.push({ output_type: "stream", name, text });
  } else if (msg.t === "returned") {
    // (Not an output to show: the run keeps it as the cell's return value.)
    return true;
  } else if (msg.t === "display") outputs.push({ output_type: "display_data", data: msg.data ?? {}, metadata: {} });
  else if (msg.t === "result") outputs.push({ output_type: "execute_result", execution_count: count, data: msg.data ?? {}, metadata: {} });
  else if (msg.t === "error") outputs.push({ output_type: "error", ename: String(msg.ename ?? "Error"), evalue: String(msg.evalue ?? ""), traceback: Array.isArray(msg.traceback) ? msg.traceback.map(String) : [] });
  return true;
}

/** The text of a data bundle as a plain reading (for a place that cannot show more): text/plain, else a note of the kinds. */
export function plainOf(data: MimeBundle): string {
  const p = data["text/plain"];
  if (typeof p === "string") return p;
  if (Array.isArray(p)) return p.join("");
  return Object.keys(data).join(", ");
}

/** A traceback line without its terminal colour codes. */
export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");
