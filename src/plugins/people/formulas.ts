import { t } from "@/lib/i18n/server";
import { EntityRef, type FormulaValue } from "@/plugins/workspace/formula";
import type { FormulaFunction } from "@/plugins/workspace/formula-point";
import { circleLabels, type Circle, type Person } from "./shared";
import { listPeople } from "./store";

/**
 * People in formulas (formula-point.ts): who @Chris or @Freunde is — for other plugins' functions too (Schulden(@Freunde)) —
 * and the functions People brings: Personen(@Kreis), Kreis(@Person). Server only.
 */

/** A circle by the words it goes by (German, English, Spanish). */
const CIRCLE_WORDS: Record<Circle, string[]> = {
  family: ["family", "familie", "familia", "verwandte"],
  friends: ["friends", "freunde", "freundinnen", "freundeskreis", "amigos"],
  work: ["work", "arbeit", "job", "kollegen", "kolleginnen", "trabajo"],
  authorities: ["authorities", "behörden", "behoerden", "gläubiger", "glaeubiger", "autoridades"],
  services: ["services", "dienste", "dienstleister", "servicios"],
};

const circleOf = (word: string): Circle | null => {
  const w = word.trim().toLowerCase();
  return (Object.entries(CIRCLE_WORDS).find(([, ws]) => ws.includes(w))?.[0] as Circle | undefined) ?? null;
};

/**
 * Who a value names: a person (@Chris picked from the menu, or a name or alias written), everyone in a circle (@Freunde,
 * @Familie), a list of them. `group`: it was a circle or a list — a function gives one value per person then. Null: no one.
 */
export function peopleOf(v: FormulaValue): { people: Person[]; group: boolean; label: string } | null {
  if (v === null || v === "") return null;
  const all = listPeople();
  if (Array.isArray(v)) {
    const each = v.map(peopleOf).filter((x): x is NonNullable<typeof x> => !!x);
    return { people: [...new Map(each.flatMap((x) => x.people).map((p) => [p.id, p])).values()], group: true, label: each.map((x) => x.label).join(", ") };
  }
  if (v instanceof EntityRef && v.kind === "person") {
    const p = all.find((x) => x.id === Number(v.id));
    return { people: p ? [p] : [], group: false, label: v.label };
  }
  const name = String(v).trim();
  const low = name.toLowerCase();
  const person = all.find((p) => [p.name, ...p.aliases].some((x) => x.toLowerCase() === low));
  if (person) return { people: [person], group: false, label: person.name };
  const circle = circleOf(name);
  if (circle) return { people: all.filter((p) => p.circle === circle), group: true, label: name };
  // A first name alone, when only one person has it.
  const first = all.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === low);
  if (first.length === 1) return { people: first, group: false, label: first[0].name };
  return { people: [], group: false, label: name };
}

/** Who a function's argument names — or why not. */
export function needPeople(v: FormulaValue | undefined, fn: string): { people: Person[]; group: boolean } {
  const who = v === undefined ? null : peopleOf(v);
  if (!who) throw new Error(`${fn}(@Person) or ${fn}(@Freunde)`);
  if (!who.people.length) throw new Error(`No person or circle "${who.label}"`);
  return who;
}

export const PEOPLE_FORMULAS: FormulaFunction[] = [
  {
    name: "Personen",
    aliases: ["People"],
    signature: "Personen(@Kreis)",
    what: "The people of a circle (Familie, Freunde, Arbeit …) — ANZAHL2(Personen(@Freunde)) counts them",
    call: (args) => needPeople(args[0], "Personen").people.map((p) => new EntityRef("person", String(p.id), p.name)),
  },
  {
    name: "Kreis",
    aliases: ["Circle"],
    signature: "Kreis(@Person)",
    what: "A person's circle (Familie, Freunde …)",
    call: (args) => {
      const who = needPeople(args[0], "Kreis");
      const labels = circleLabels(t);
      const one = (p: Person) => (p.circle ? labels[p.circle] : "");
      return who.group ? who.people.map(one) : one(who.people[0]);
    },
  },
];
