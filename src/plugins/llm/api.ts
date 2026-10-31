import { getContextPrefs, setStepPrefs } from "@/lib/runs/context-prefs";
import { CONTEXT_STEP_IDS, contextSteps, type ContextStepId } from "@/lib/runs/context-prefs-shared";
import { t } from "@/lib/i18n/server";
import { ApiError, str, type ApiContribution, type Params } from "@/lib/plugins/api-kit";

/**
 * The LLM plugin's part of the plugin API: the instructions and numbers of the AI steps (Prompts: the briefing, the mail
 * review, the branch names …). The AI may propose changing them from what a colleague said ("llm.steps.update" is offered
 * as an Auto-Aktion): it is given the current instructions (and what Zeff knows about the topic) so it writes the new
 * text as an adjustment of what is there, not beside it.
 */

const isStep = (v: string): v is ContextStepId => (CONTEXT_STEP_IDS as readonly string[]).includes(v);

/** The numbers of a step the caller may set: only its own keys, as whole numbers within the limits. */
function numbersOf(step: ContextStepId, raw: unknown): Record<string, number> {
  const def = contextSteps(t).find((s) => s.id === step);
  const o = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!def || !o || typeof o !== "object" || Array.isArray(o)) return {};
  const out: Record<string, number> = {};
  for (const n of def.numbers) {
    const v = Number((o as Record<string, unknown>)[n.key]);
    if (Number.isFinite(v)) out[n.key] = Math.min(n.max, Math.max(n.min, Math.round(v)));
  }
  return out;
}

/** What Zeff has now about the steps a text is about (and every step with instructions): their words and numbers, the notes kept for branch names, a few hits of the knowledge base. */
async function currentState(q: { ticket: string; text: string }): Promise<string[]> {
  const steps = contextSteps(t);
  const prefs = getContextPrefs();
  const lower = q.text.toLowerCase();
  const mentions = (s: (typeof steps)[number]) => `${s.id} ${s.label}`.toLowerCase().split(/\s+/).some((w) => w.length > 3 && lower.includes(w));
  const lines: string[] = [];
  for (const s of steps) {
    const p = prefs[s.id];
    const about = mentions(s);
    if (!p.extra.trim() && !about) continue;
    const nums = s.numbers.map((n) => `${n.key}=${p.numbers[n.key] ?? n.default}`).join(", ");
    lines.push(`Schritt „${s.id}“ (${s.label}) — aktuelle Anweisungen: ${p.extra.trim() ? `„${p.extra.trim()}“` : "(keine)"}${nums ? ` — Zahlen: ${nums}` : ""}`);
    if (!about) continue;
    if (s.id === "branchname" && q.ticket) {
      const { artifactsFor } = await import("@/lib/work/branch-knowledge");
      for (const a of artifactsFor(q.ticket)) lines.push(`  Festgehalten (${a.kind === "rule" ? "Regel" : "Code Change"}, ${a.ticket}): ${a.text}`);
    }
    // The knowledge base, as far as it answers quickly: what is written down about the topic.
    try {
      const { isInstalled } = await import("@/plugins/state");
      if (isInstalled("knowledge")) {
        const { knowledgeSearch } = await import("@/plugins/knowledge/client");
        const r = await Promise.race([knowledgeSearch(`${s.label} ${q.text.slice(0, 120)}`, 3), new Promise<null>((res) => setTimeout(() => res(null), 4000))]);
        for (const pg of r?.pages ?? []) lines.push(`  Wissen: ${pg.title} — ${pg.snippet.replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim().slice(0, 200)}`);
      }
    } catch {
      // No knowledge server: the instructions above are what there is.
    }
  }
  return lines;
}

export const LLM_API: ApiContribution = {
  permissions: () => ({
    "llm.read": t("Read the instructions and numbers of the AI steps"),
    "llm.write": t("Change the instructions and numbers of the AI steps"),
  }),
  methods: {
    "llm.steps.list": {
      perm: "llm.read",
      summary: "The AI steps (briefing, mail review, branch names …) with your instructions and numbers.",
      run: () => {
        const prefs = getContextPrefs();
        return contextSteps(t).map((s) => ({ id: s.id, label: s.label, extra: prefs[s.id].extra, numbers: Object.fromEntries(s.numbers.map((n) => [n.key, prefs[s.id].numbers[n.key] ?? n.default])) }));
      },
    },
    "llm.steps.update": {
      perm: "llm.write",
      summary: "Change a step's instructions (`extra`, the whole new text) and/or numbers (`numbers`: {key: value}).",
      run: (p: Params) => {
        const step = str(p, "step", { required: true, max: 40 });
        if (!isStep(step)) throw new ApiError("bad_request", `step: one of ${CONTEXT_STEP_IDS.join(", ")}`);
        const patch: { extra?: string; numbers?: Record<string, number> } = {};
        if (typeof p.extra === "string") patch.extra = p.extra.slice(0, 2000);
        const numbers = numbersOf(step, p.numbers);
        if (Object.keys(numbers).length) patch.numbers = numbers;
        if (!Object.keys(patch).length) throw new ApiError("bad_request", "extra or numbers: nothing to change");
        setStepPrefs(step, patch);
        return true;
      },
      offer: {
        label: "Adjust the instructions of an AI step",
        when: `Jemand (ein Kollege im Chat, in einer Mail, in einem Ticket — oder ich) sagt, wie Zeff bei einem KI-Schritt vorgehen soll: z. B. wie Branches benannt werden („nach dem Code Change, nicht nach dem Ticket-Titel“), worauf der Wochenbericht achten soll, wie Antworten klingen sollen. Du schreibst die NEUEN Anweisungen des Schritts als Anpassung der bestehenden (sie stehen unter „Bestehendes in Zeff“ — übernimm, was weiter gilt, ändere oder entferne, was widerspricht, ergänze die neue Absprache; kurz, höchstens 2000 Zeichen, in der Sprache der Anweisungen). Schritte: ${CONTEXT_STEP_IDS.join(", ")}.`,
        fields: {
          step: `der Schritt: ${CONTEXT_STEP_IDS.join(" | ")}`,
          extra: "der vollständige neue Anweisungstext des Schritts (die bestehenden Anweisungen, angepasst) — leer lassen, wenn nur Zahlen geändert werden",
          numbers: 'optional: ein JSON-Objekt (als Text) mit den Zahlen des Schritts, z. B. {"maxChars": 30, "words": 4} — nur was sich ändert',
        },
        example: { step: "branchname", extra: "Branch-Namen nach dem Code Change benennen, nicht nach dem Ticket-Titel (Absprache mit Thomas).", numbers: '{"words": 3}' },
        check: (raw) => {
          const step = raw.step?.trim() ?? "";
          if (!isStep(step)) return null;
          const extra = (raw.extra ?? "").trim().slice(0, 2000);
          const numbers = numbersOf(step, raw.numbers);
          return extra || Object.keys(numbers).length ? { step, ...(extra ? { extra } : {}), ...(Object.keys(numbers).length ? { numbers } : {}) } : null;
        },
        describe: (p) => {
          const label = contextSteps(t).find((s) => s.id === p.step)?.label ?? String(p.step);
          const nums = p.numbers && typeof p.numbers === "object" ? Object.entries(p.numbers as Record<string, number>).map(([k, v]) => `${k} = ${v}`).join(", ") : "";
          return { title: t("Adjust the AI step “{step}”", { step: label }), body: [typeof p.extra === "string" ? p.extra : "", nums].filter(Boolean).join("\n\n") };
        },
        context: currentState,
      },
    },
  },
};
