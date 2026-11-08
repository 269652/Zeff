"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { AskField, FieldSpec, FlowNode } from "@/plugins/workspace/flows/types";
import { KIND_ICON } from "./Canvas";

/**
 * The node picked on the canvas, edited: an action's inputs drawn from its catalog entry (each a text that may hold {{ expressions }};
 * a JSON field as JSON), a condition, a script's code, an approval's options … The paths it can read stand under it as chips: a
 * click puts {{ path }} where the cursor was.
 */

export type CatalogAction = { name: string; group: string; label: string; summary: string; input: FieldSpec[]; output: string; needs?: string[]; writes?: boolean };

type Props = {
  node: FlowNode;
  catalog: CatalogAction[];
  flows: string[];
  paths: { path: string; what: string }[];
  onChange: (patch: Partial<FlowNode>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  run?: { input?: unknown; output?: unknown; error?: string; logs?: string[] };
};

type Target = { el: HTMLInputElement | HTMLTextAreaElement; set: (v: string) => void } | null;

const asText = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
/** What was typed into a JSON field: JSON when it is, else the text (an expression). */
const fromJsonText = (s: string): unknown => {
  const x = s.trim();
  if (!x) return undefined;
  if (/^[[{]/.test(x)) {
    try {
      return JSON.parse(x);
    } catch {
      return s;
    }
  }
  return s;
};

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label mb-0">{label}</span>
      {children}
      {help && <span className="block text-xs text-zinc-500">{help}</span>}
    </label>
  );
}

type Track = (el: HTMLInputElement | HTMLTextAreaElement, set: (v: string) => void) => void;

/** A text input that tells the inspector it had the focus (for the path chips). */
function Expr({ value, onChange, multiline, mono, placeholder, track }: { value: string; onChange: (v: string) => void; multiline?: boolean; mono?: boolean; placeholder?: string; track: Track }) {
  const cls = `input ${mono ? "font-mono text-xs" : ""}`;
  return multiline ? (
    <textarea className={cls} rows={Math.min(14, Math.max(3, value.split(/\r?\n/).length + 1))} value={value} placeholder={placeholder} spellCheck={false} onFocus={(e) => track(e.currentTarget, onChange)} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className={cls} value={value} placeholder={placeholder} spellCheck={false} onFocus={(e) => track(e.currentTarget, onChange)} onChange={(e) => onChange(e.target.value)} />
  );
}

/** A record of name → value (set's vars, a call's or a script's input). */
function Pairs({ value, onChange, keyLabel, track }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; keyLabel: string; track: Track }) {
  const t = useT();
  const entries = Object.entries(value);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <input className="input w-28 shrink-0 font-mono text-xs" value={k} aria-label={keyLabel} onChange={(e) => onChange(Object.fromEntries(entries.map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv]))))} />
          <div className="min-w-0 flex-1">
            <Expr value={asText(v)} track={track} onChange={(x) => onChange({ ...value, [k]: x })} />
          </div>
          <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Remove")} onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange({ ...value, [`name${entries.length + 1}`]: "" })}>
        + {keyLabel}
      </button>
    </div>
  );
}

export function Inspector(p: Props) {
  const t = useT();
  const target = useRef<Target>(null);
  const [, bump] = useState(0);
  const n = p.node;

  const track: Track = (el, set) => (target.current = { el, set });

  const insert = (path: string) => {
    const tg = target.current;
    if (!tg) return;
    const el = tg.el;
    const at = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? at;
    tg.set(`${el.value.slice(0, at)}{{ ${path} }}${el.value.slice(end)}`);
    bump((x) => x + 1);
    requestAnimationFrame(() => el.focus());
  };

  const action = n.kind === "action" ? p.catalog.find((a) => a.name === n.action) : undefined;
  const groups = [...new Set(p.catalog.map((a) => a.group))];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {KIND_ICON[n.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{n.label || n.id}</div>
          <div className="font-mono text-xs text-zinc-500">steps.{n.id}</div>
        </div>
        <button type="button" className="icon-btn" aria-label={t("Move up")} title={t("Move up")} onClick={() => p.onMove(-1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={t("Move down")} title={t("Move down")} onClick={() => p.onMove(1)}>
          ↓
        </button>
        <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Delete the node")} title={t("Delete the node")} onClick={p.onRemove}>
          🗑
        </button>
      </div>

      <Field label={t("Label")}>
        <input className="input" value={n.label ?? ""} placeholder={n.id} onChange={(e) => p.onChange({ label: e.target.value || undefined })} />
      </Field>

      {n.kind === "action" && (
        <>
          <Field label={t("Action")} help={action ? `${action.summary} → ${action.output}` : undefined}>
            <select className="input" value={n.action} onChange={(e) => p.onChange({ action: e.target.value } as Partial<FlowNode>)}>
              {!action && <option value={n.action}>{n.action}</option>}
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {p.catalog
                    .filter((a) => a.group === g)
                    .map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.label} ({a.name})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {action?.needs?.length ? <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t("Needs the flow's permission: {needs}", { needs: action.needs.join(", ") })}</p> : null}
          {(action?.input ?? []).map((f) => (
            <Field key={f.name} label={`${f.label || f.name}${f.required ? " *" : ""}`} help={f.help ?? (f.options ? f.options.join(" | ") : undefined)}>
              {f.type === "json" || f.type === "list" ? (
                <Expr track={track} value={asText(n.input[f.name])} multiline mono placeholder={f.type === "list" ? '["a", "b"] or {{ … }}' : '{ "key": "{{ … }}" }'} onChange={(v) => p.onChange({ input: { ...n.input, [f.name]: fromJsonText(v) } } as Partial<FlowNode>)} />
              ) : f.type === "boolean" ? (
                <select className="input" value={asText(n.input[f.name])} onChange={(e) => p.onChange({ input: { ...n.input, [f.name]: e.target.value === "" ? undefined : e.target.value === "true" } } as Partial<FlowNode>)}>
                  <option value="">{t("default")}</option>
                  <option value="true">{t("yes")}</option>
                  <option value="false">{t("no")}</option>
                </select>
              ) : (
                <Expr track={track} value={asText(n.input[f.name])} multiline={f.name === "text" || f.name === "html" || f.name === "prompt" || f.name === "instruction"} placeholder={f.default !== undefined ? String(f.default) : undefined} onChange={(v) => p.onChange({ input: { ...n.input, [f.name]: v === "" ? undefined : v } } as Partial<FlowNode>)} />
              )}
            </Field>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("Retries")}>
              <input className="input" type="number" min={0} max={5} value={n.retry ?? 0} onChange={(e) => p.onChange({ retry: Number(e.target.value) || undefined } as Partial<FlowNode>)} />
            </Field>
            <Field label={t("On an error")}>
              <select className="input" value={n.onError ?? "fail"} onChange={(e) => p.onChange({ onError: e.target.value === "continue" ? "continue" : undefined } as Partial<FlowNode>)}>
                <option value="fail">{t("the flow fails")}</option>
                <option value="continue">{t("go on (steps.x.error)")}</option>
              </select>
            </Field>
          </div>
        </>
      )}

      {n.kind === "set" && (
        <Field label={t("Variables")}>
          <Pairs track={track} value={n.vars} keyLabel={t("variable")} onChange={(vars) => p.onChange({ vars } as Partial<FlowNode>)} />
        </Field>
      )}

      {n.kind === "if" && (
        <Field label={t("Condition")} help={t("e.g. steps.search.hits | count > 0 and input.force != true")}>
          <Expr track={track} value={n.when} mono onChange={(when) => p.onChange({ when } as Partial<FlowNode>)} />
        </Field>
      )}

      {n.kind === "switch" && (
        <>
          <Field label={t("Value")}>
            <Expr track={track} value={n.on} mono onChange={(on) => p.onChange({ on } as Partial<FlowNode>)} />
          </Field>
          <Field label={t("Cases")}>
            <div className="space-y-1.5">
              {n.cases.map((c, i) => (
                <div key={i} className="flex gap-1.5">
                  <input className="input font-mono text-xs" value={c.value} onChange={(e) => p.onChange({ cases: n.cases.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) } as Partial<FlowNode>)} />
                  <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Remove")} onClick={() => p.onChange({ cases: n.cases.filter((_, j) => j !== i) } as Partial<FlowNode>)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => p.onChange({ cases: [...n.cases, { value: "", nodes: [] }] } as Partial<FlowNode>)}>
                + {t("case")}
              </button>
            </div>
          </Field>
        </>
      )}

      {n.kind === "foreach" && (
        <>
          <Field label={t("Items")} help={t("A list: steps.search.hits, input.ids …")}>
            <Expr track={track} value={n.items} mono onChange={(items) => p.onChange({ items } as Partial<FlowNode>)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("Name of the item")}>
              <input className="input font-mono text-xs" value={n.as ?? ""} placeholder="item" onChange={(e) => p.onChange({ as: e.target.value || undefined } as Partial<FlowNode>)} />
            </Field>
            <Field label={t("At most")}>
              <input className="input" type="number" min={1} max={1000} value={n.max ?? 500} onChange={(e) => p.onChange({ max: Number(e.target.value) || undefined } as Partial<FlowNode>)} />
            </Field>
          </div>
        </>
      )}

      {n.kind === "parallel" && (
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => p.onChange({ branches: [...n.branches, []] } as Partial<FlowNode>)}>
            + {t("branch")}
          </button>
          {n.branches.length > 1 && (
            <button type="button" className="btn btn-sm" onClick={() => p.onChange({ branches: n.branches.slice(0, -1) } as Partial<FlowNode>)}>
              − {t("branch")}
            </button>
          )}
        </div>
      )}

      {n.kind === "script" && (
        <>
          <Field label={t("JavaScript")} help={t("Runs in a sandbox (no network, no files, 3 s): input, steps, vars, item, row are there as data; return the output; log(…) writes to the run's log.")}>
            <textarea className="input font-mono text-xs" rows={14} spellCheck={false} value={n.code} onChange={(e) => p.onChange({ code: e.target.value } as Partial<FlowNode>)} />
          </Field>
          <Field label={t("Its input")}>
            <Pairs track={track} value={(n.input as Record<string, unknown>) ?? {}} keyLabel={t("name")} onChange={(input) => p.onChange({ input } as Partial<FlowNode>)} />
          </Field>
        </>
      )}

      {n.kind === "ask" && (
        <>
          <Field label={t("Question")}>
            <Expr track={track} value={n.title} onChange={(title) => p.onChange({ title } as Partial<FlowNode>)} />
          </Field>
          <Field label={t("Details")}>
            <Expr track={track} value={n.text ?? ""} multiline onChange={(text) => p.onChange({ text: text || undefined } as Partial<FlowNode>)} />
          </Field>
          <div className="space-y-1.5">
            <span className="label mb-0">{t("Answers")}</span>
            {n.fields.map((f, i) => {
              const setF = (patch: Partial<AskField>) => p.onChange({ fields: n.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) } as Partial<FlowNode>);
              return (
                <div key={i} className="space-y-1 rounded-md border border-zinc-200 p-1.5 dark:border-zinc-700">
                  <div className="flex gap-1">
                    <input className="input w-24 font-mono text-xs" value={f.name} aria-label={t("Name")} onChange={(e) => setF({ name: e.target.value })} />
                    <select className="input text-xs" value={f.kind} aria-label={t("Kind")} onChange={(e) => setF({ kind: e.target.value as AskField["kind"] })}>
                      <option value="scale">{t("scale")}</option>
                      <option value="number">{t("number")}</option>
                      <option value="choice">{t("choice")}</option>
                      <option value="yesno">{t("yes / no")}</option>
                      <option value="text">{t("text")}</option>
                    </select>
                    <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Remove")} onClick={() => p.onChange({ fields: n.fields.filter((_, j) => j !== i) } as Partial<FlowNode>)}>
                      ×
                    </button>
                  </div>
                  <input className="input text-xs" placeholder={t("Label")} value={f.label ?? ""} onChange={(e) => setF({ label: e.target.value || undefined })} />
                  {(f.kind === "scale" || f.kind === "number") && (
                    <div className="flex gap-1">
                      <input className="input text-xs" type="number" placeholder="min" value={f.min ?? ""} onChange={(e) => setF({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      <input className="input text-xs" type="number" placeholder="max" value={f.max ?? ""} onChange={(e) => setF({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    </div>
                  )}
                  {f.kind === "choice" && <input className="input text-xs" placeholder={t("Options, separated by commas")} value={(f.options ?? []).join(", ")} onChange={(e) => setF({ options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />}
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" className="accent-indigo-600" checked={!!f.required} onChange={(e) => setF({ required: e.target.checked || undefined })} />
                    {t("required")}
                  </label>
                </div>
              );
            })}
            <button type="button" className="btn btn-sm" onClick={() => p.onChange({ fields: [...n.fields, { name: `field${n.fields.length + 1}`, kind: "text" }] } as Partial<FlowNode>)}>
              + {t("Answer")}
            </button>
          </div>
          <Field label={t("Unanswered, it lapses after (minutes)")} help={t("A newer question of this flow replaces one still open.")}>
            <input className="input" type="number" min={1} value={n.expiresMinutes ?? ""} onChange={(e) => p.onChange({ expiresMinutes: Number(e.target.value) || undefined } as Partial<FlowNode>)} />
          </Field>
        </>
      )}

      {n.kind === "approve" && (
        <>
          <Field label={t("Question")}>
            <Expr track={track} value={n.title} onChange={(title) => p.onChange({ title } as Partial<FlowNode>)} />
          </Field>
          <Field label={t("Details")}>
            <Expr track={track} value={n.text ?? ""} multiline onChange={(text) => p.onChange({ text: text || undefined } as Partial<FlowNode>)} />
          </Field>
          <Field label={t("Choices")} help={t("Separated by commas; steps.{id}.choice is the one picked.", { id: n.id })}>
            <input className="input" value={(n.options ?? []).join(", ")} onChange={(e) => p.onChange({ options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } as Partial<FlowNode>)} />
          </Field>
        </>
      )}

      {n.kind === "wait" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Minutes")}>
            <input className="input" type="number" min={1} value={n.minutes ?? ""} onChange={(e) => p.onChange({ minutes: Number(e.target.value) || undefined } as Partial<FlowNode>)} />
          </Field>
          <Field label={t("Or until")}>
            <Expr track={track} value={n.until ?? ""} mono placeholder="{{ row.Due }}" onChange={(until) => p.onChange({ until: until || undefined } as Partial<FlowNode>)} />
          </Field>
        </div>
      )}

      {n.kind === "call" && (
        <>
          <Field label={t("Flow")}>
            <select className="input" value={n.flow} onChange={(e) => p.onChange({ flow: e.target.value } as Partial<FlowNode>)}>
              <option value="">—</option>
              {p.flows.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Its input")}>
            <Pairs track={track} value={n.input} keyLabel={t("input")} onChange={(input) => p.onChange({ input } as Partial<FlowNode>)} />
          </Field>
        </>
      )}

      {n.kind === "return" && (
        <Field label={t("Output")} help={t("An expression, or JSON whose texts hold expressions.")}>
          <Expr track={track} value={asText(n.value)} multiline mono onChange={(v) => p.onChange({ value: fromJsonText(v) ?? "" } as Partial<FlowNode>)} />
        </Field>
      )}

      {n.kind === "fail" && (
        <Field label={t("Message")}>
          <Expr track={track} value={n.message} onChange={(message) => p.onChange({ message } as Partial<FlowNode>)} />
        </Field>
      )}

      <div>
        <div className="label">{t("It can read")}</div>
        <div className="flex flex-wrap gap-1">
          {p.paths.map((x) => (
            <button key={x.path} type="button" className="rounded-md border border-zinc-200 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-indigo-950" title={x.what} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(x.path)}>
              {x.path}
            </button>
          ))}
        </div>
      </div>

      {p.run && (
        <div className="space-y-1">
          <div className="label">{t("Last run")}</div>
          {p.run.error && <pre className="overflow-x-auto rounded-md bg-red-50 p-2 text-xs whitespace-pre-wrap text-red-800 dark:bg-red-950/40 dark:text-red-300">{p.run.error}</pre>}
          {p.run.input !== undefined && (
            <details>
              <summary className="cursor-pointer text-xs text-zinc-500">{t("Input")}</summary>
              <pre className="max-h-60 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-950">{JSON.stringify(p.run.input, null, 2)}</pre>
            </details>
          )}
          {p.run.output !== undefined && (
            <details open>
              <summary className="cursor-pointer text-xs text-zinc-500">{t("Output")}</summary>
              <pre className="max-h-72 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-950">{JSON.stringify(p.run.output, null, 2)}</pre>
            </details>
          )}
          {p.run.logs?.length ? <pre className="max-h-40 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-950">{p.run.logs.join("\n")}</pre> : null}
        </div>
      )}
    </div>
  );
}
