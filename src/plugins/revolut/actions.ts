/**
 * The Revolut plugin's action: paying someone by their RevTag — the click opens their revolut.me page (in the Revolut app on
 * the phone), you send the money yourself; the amount and the note are on the card to copy. The AI proposes it when the
 * person's RevTag is known (a detail of their profile, read off what was said about them). Client-safe.
 */
import { action, EN, str } from "../actions/types";

declare module "@/lib/boards/shared" {
  interface TodoOpMap {
    /** A payment by RevTag: to whom, their tag (without @), the amount in euro ("150.00", empty: you type it), a note. */
    "revolut-pay": { name: string; revtag: string; amount: string; note: string };
  }
}

/** "@chris.b", "revolut.me/chris.b", "chris.b" → "chris.b" — empty when it is no tag. */
export function revtagOf(v: unknown): string {
  const s = str(v).replace(/^https?:\/\//i, "").replace(/^revolut\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,30}$/.test(s) ? s.toLowerCase() : "";
}

function amountOf(v: unknown): string {
  const s = str(v).replace(/[€\s]|EUR/gi, "");
  if (!s) return "";
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e7 ? n.toFixed(2) : "";
}

/**
 * Their revolut.me link, prefilled: ?currency=EUR&amount=<cents>&note=<at most 64 characters> (what Revolut's payment page
 * reads — not a documented API; a blank amount or note left out).
 */
export function revolutLink(revtag: string, amount = "", note = ""): string {
  const q = new URLSearchParams({ currency: "EUR" });
  const cents = Math.round(Number(amount) * 100);
  if (amount && cents > 0) q.set("amount", String(cents));
  const n = [...note.trim()].slice(0, 64).join("");
  if (n) q.set("note", n);
  return `https://revolut.me/${encodeURIComponent(revtag)}?${q.toString().replace(/\+/g, "%20")}`;
}

const euro = (amount: string) => (amount ? `${Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €` : "");

export const REVOLUT_ACTIONS = [
  action({
    type: "revolut-pay",
    plugin: "revolut",
    label: "Pay with Revolut",
    verb: "Pay",
    offer: {
      when: "Geld an eine Person zahlen oder zurückgeben, deren RevTag in den Konten meiner Kontakte steht (oder im Todo, in seinen Quellen) — dann statt einer Überweisung: ein Klick öffnet ihre revolut.me-Seite. Nie einen RevTag erfinden.",
      fields: {
        name: "die Person, wie sie heißt",
        revtag: "ihr RevTag, ohne @",
        amount: "der Betrag in Euro (z. B. 150) — leer, wenn er nicht feststeht",
        note: "eine kurze Notiz für die Zahlung (wofür) — höchstens 64 Zeichen",
      },
      example: { type: "revolut-pay", name: "Chris Ballhaus", revtag: "chrisb", amount: "150", note: "Zurück, danke fürs Leihen!" },
    },
    clean: (o) => {
      const revtag = revtagOf(o.revtag);
      if (!str(o.name) || !revtag) return null;
      return { type: "revolut-pay", name: str(o.name).slice(0, 70), revtag, amount: amountOf(o.amount), note: str(o.note).slice(0, 140) };
    },
    title: (op, t = EN) => (op.amount ? t("Pay {amount} to {name} with Revolut", { amount: euro(op.amount), name: op.name }) : t("Pay {name} with Revolut", { name: op.name })),
    note: (op, t = EN) => ({ heading: t("Pay {name} with Revolut", { name: op.name }), detail: [euro(op.amount), op.note].filter(Boolean).join(" · ") || null, body: `@${op.revtag} · revolut.me/${op.revtag}` }),
    // Their revolut.me page with the amount and the note: on the phone it opens the Revolut app; you send the money yourself.
    href: (op) => revolutLink(op.revtag, op.amount, op.note),
  }),
];
