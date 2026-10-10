import { inThisAccount } from "@/db/accounts";
import { getSqlite } from "@/db";
import { errorMessage } from "@/lib/errors";
import { listFacts } from "@/lib/facts";
import { isInstalled } from "@/plugins/state";
import { DATE_KINDS, isDateKind, parseDayMonth, type DateKind, type Person } from "./shared";
import { addDate, getPerson, listPeople, namesOf, namesThem } from "./store";

/**
 * A person's dates found — as proposals you confirm (no reminder before you do):
 * - from the facts the Mail-Durchsicht kept ("Nadines Geburtstag: 16.10."), without AI;
 * - by the AI (LLM task "Personen-Daten"), from what the knowledge, the facts and your messages
 *   say of them — only dates something says outright.
 */

const kindOf = (text: string): DateKind => (/geburtstag|geb\.|birthday|wiegenfest/i.test(text) ? "birthday" : /jahrestag|hochzeitstag|anniversary|kennenlerntag/i.test(text) ? "anniversary" : "other");

/** The facts naming them with a date in them: proposed. How many new. */
export function datesFromFacts(p: Person): number {
  let n = 0;
  for (const f of listFacts(2000)) {
    const text = `${f.subject}: ${f.text}`;
    if (!namesThem(p, text)) continue;
    const date = parseDayMonth(f.text) ?? parseDayMonth(f.subject);
    if (!date) continue;
    const kind = kindOf(text);
    const id = addDate(p.id, { kind, label: kind === "other" ? f.subject : "", day: date.day, month: date.month, year: date.year, yearly: kind !== "other" || !date.year, source: "fact", sourceText: `Fact: ${text}`.slice(0, 500), confirmed: false });
    if (id) n++;
  }
  return n;
}

type Answer = { dates?: { kind?: string; label?: string; day?: number; month?: number; year?: number | null; yearly?: boolean; quote?: string }[] };
const SCHEMA = {
  type: "object",
  required: ["dates"],
  properties: {
    dates: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "day", "month", "quote"],
        properties: {
          kind: { type: "string", enum: [...DATE_KINDS] },
          label: { type: "string", description: "Bei kind=other: wofür das Datum steht (z. B. „Umzug nach Berlin“)." },
          day: { type: "integer" },
          month: { type: "integer" },
          year: { type: ["integer", "null"], description: "Geburtsjahr (Geburtstag), erstes Jahr (Jahrestag) oder das Jahr des Tages — nur wenn es dasteht." },
          yearly: { type: "boolean", description: "Kehrt jedes Jahr wieder (Geburtstag, Jahrestag: ja; ein einzelner Termin: nein)." },
          quote: { type: "string", description: "Die Stelle, die das Datum belegt (wörtlich, kurz)." },
        },
      },
    },
  },
};

/** What Zeff has about them that could hold a date: the knowledge's pages, facts, messages naming them. */
async function evidence(p: Person): Promise<string[]> {
  const out: string[] = [];
  const names = namesOf(p);
  if (isInstalled("knowledge")) {
    try {
      const { knowledgeSearch } = await import("@/plugins/knowledge/client");
      const seen = new Set<string>();
      for (const q of [`${p.name} Geburtstag`, `${p.name} Jahrestag Datum`, p.name]) {
        const r = await knowledgeSearch(q, 6);
        for (const page of r.pages) {
          if (seen.has(page.id)) continue;
          seen.add(page.id);
          out.push(`[Wissen: ${page.title}] ${page.summary ?? ""} … ${page.snippet.replace(/[⟦⟧]/g, "")}`);
        }
        for (const e of r.entities) if (names.some((n) => n.toLowerCase() === e.name.toLowerCase())) out.push(`[Wissen: Entität ${e.name}] ${e.summary}`);
      }
    } catch {
      // the knowledge server doesn't answer: without it
    }
  }
  for (const f of listFacts(2000)) if (namesThem(p, `${f.subject} ${f.text}`)) out.push(`[Fakt] ${f.subject}: ${f.text}`);
  try {
    // Messages naming them with a date or a word for one in them.
    type R = { folder: string; from_name: string | null; subject: string; preview: string; received_at: string };
    const rows = getSqlite()
      .prepare("select folder, from_name, subject, preview, received_at from emails where (preview like '%geburtstag%' or preview like '%jahrestag%' or preview like '%hochzeit%' or preview glob '*[0-9].[0-9]*') order by received_at desc limit 3000")
      .all() as R[];
    for (const r of rows) {
      const text = `${r.subject} ${r.preview}`;
      if (r.folder === "WhatsApp" ? namesThem(p, `${r.subject} ${r.from_name ?? ""} ${r.preview}`) : namesThem(p, text)) out.push(`[${r.folder} ${r.received_at.slice(0, 10)}, von ${r.from_name ?? "?"}] ${r.preview.slice(0, 400)}`);
      if (out.length > 80) break;
    }
  } catch {
    // no messages kept
  }
  return out.slice(0, 80);
}

/** The AI's dates for them: proposed. How many new. */
export async function datesWithAi(p: Person): Promise<number> {
  const found = await evidence(p);
  if (!found.length) return 0;
  const { llm } = await import("@/plugins/llm/run");
  const prompt = `Finde die wichtigen Daten einer Person meines Lebens: ihren Geburtstag, Jahrestage (Hochzeit, Kennenlernen …) und andere Daten, die man sich merken sollte. Die Person: ${p.name}${p.aliases.length ? ` (auch: ${p.aliases.join(", ")})` : ""}.
Unten steht, was meine Wissensbasis, meine Fakten und meine Nachrichten über sie sagen (je Zeile mit Quelle). Nimm NUR Daten, die dort ausdrücklich stehen und sicher DIESE Person betreffen — nichts erschließen, nichts raten (ein „morgen hat sie Geburtstag“ in einer Nachricht vom 15.10. heißt 16.10.; das darfst du ausrechnen). Termine, die nur einmal stattfinden (ein Arzttermin, eine Party), nur, wenn sie noch kommen. Zu jedem Datum die belegende Stelle als quote. Nichts gefunden: eine leere Liste. Nur JSON nach diesem Schema:
${JSON.stringify(SCHEMA)}

${found.join("\n")}`;
  const r = await llm<Answer>("people-dates", prompt, SCHEMA, { timeoutMs: 240000 });
  let n = 0;
  for (const x of r.output?.dates ?? []) {
    const kind = isDateKind(x.kind) ? x.kind : "other";
    const day = Number(x.day);
    const month = Number(x.month);
    const year = x.year ? Number(x.year) : null;
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) continue;
    const id = addDate(p.id, { kind, label: kind === "other" ? String(x.label ?? "").trim() : "", day, month, year, yearly: x.yearly ?? kind !== "other", source: "ai", sourceText: `AI: “${String(x.quote ?? "").slice(0, 400)}”`, confirmed: false });
    if (id) n++;
  }
  return n;
}

/** Facts and AI for one person: how many dates proposed. */
export async function findDates(personId: number, { ai = true } = {}): Promise<{ facts: number; ai: number }> {
  const p = getPerson(personId);
  if (!p) throw new Error("That person doesn't exist (any more).");
  const facts = datesFromFacts(p);
  const found = ai && isInstalled("llm") ? await datesWithAi(p) : 0;
  return { facts, ai: found };
}

const state = globalThis as unknown as { __zeffPeopleDates?: { done: number; total: number; found: number; error: string | null } | null };
export const findAllProgress = () => state.__zeffPeopleDates ?? null;

/** Everyone without a birthday yet: facts and AI, one after another, in the background. */
export function findAllDates(): boolean {
  // Kept in the account it was started in — whichever is switched to while it runs.
  return inThisAccount(() => {
    if (state.__zeffPeopleDates) return false;
    const people = listPeople().filter((p) => !(getSqlite().prepare("select 1 from people_dates where person_id = ? and kind = 'birthday'").get(p.id)));
    const run = { done: 0, total: people.length, found: 0, error: null as string | null };
    state.__zeffPeopleDates = run;
    void (async () => {
      for (const p of people) {
        try {
          const r = await findDates(p.id);
          run.found += r.facts + r.ai;
        } catch (e) {
          run.error = errorMessage(e);
        }
        run.done++;
      }
    })().finally(() => {
      state.__zeffPeopleDates = null;
    });
    return true;
  });
}
