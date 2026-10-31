/**
 * The Cases plugin's action: a bank transfer as a GiroCode — the click opens Zeff's page with the code to scan with
 * your banking app (and every field to copy); you send the money yourself. Zeff puts it on the todos that are payments
 * by itself (payments.ts), and the AI may propose it. Client-safe.
 */
import { ibanValid } from "@/lib/girocode";
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/todos/shared" {
  interface TodoOpMap {
    /** A transfer: to whom, the account, the amount in euro ("11.52", empty: you type it), the purpose. */
    "bank-transfer": { name: string; iban: string; bic: string; amount: string; purpose: string };
  }
}

/** "11,52", "3.618,13 €", 300 → "11.52", "3618.13", "300.00" — empty when it is no amount. */
function amountOf(v: unknown): string {
  const s = str(v).replace(/[€\s]|EUR/gi, "");
  if (!s) return "";
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n.toFixed(2) : "";
}

const euro = (amount: string) => (amount ? `${Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €` : "");

export const CASES_ACTIONS = [
  action({
    type: "bank-transfer",
    plugin: "cases",
    label: "Transfer (GiroCode)",
    verb: "Transfer",
    offer: {
      when: "Eine Überweisung: das Todo verlangt, Geld zu zahlen oder zurückzugeben (eine Rate, eine Rechnung, eine Restforderung, Geld, das ich jemandem schulde), und der Empfänger steht fest. Die IBAN aus dem Todo, seinen Quellen, dem Wissen oder den Konten meiner Kontakte (unten); kennt sie keiner, bleibt sie leer — ich trage sie einmal ein, Zeff merkt sie sich am Kontakt. Ein Klick zeigt den GiroCode für die Banking-App. Nie eine IBAN erfinden.",
      fields: {
        name: "der Empfänger, wie er angegeben ist (Kontoinhaber; bei einem Kontakt sein Name)",
        iban: "die IBAN, genau abgeschrieben — leer, wenn sie nirgends steht",
        bic: "die BIC, wenn angegeben — sonst leer",
        amount: "der Betrag in Euro (z. B. 11,52) — leer, wenn er nicht feststeht",
        purpose: "der Verwendungszweck, wie verlangt (meist das Aktenzeichen)",
      },
      example: { type: "bank-transfer", name: "Wagner Dienstkonto", iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001", amount: "24,80", purpose: "DR II 456/26" },
    },
    clean: (o) => {
      // No IBAN yet (a contact's account isn't known): you enter it on the card, once — a wrong one is never kept.
      const iban = str(o.iban).toUpperCase();
      if (!str(o.name) || (iban && !ibanValid(iban))) return null;
      return { type: "bank-transfer", name: str(o.name).slice(0, 70), iban, bic: str(o.bic).replace(/\s+/g, "").toUpperCase().slice(0, 11), amount: amountOf(o.amount), purpose: str(o.purpose).slice(0, 140) };
    },
    title: (op, t = EN) => (op.amount ? t("Transfer {amount} to {name}", { amount: euro(op.amount), name: op.name }) : t("Transfer to {name}", { name: op.name })),
    note: (op, t = EN) => ({ heading: t("Transfer to {name}", { name: op.name }), detail: [euro(op.amount), op.purpose].filter(Boolean).join(" · ") || null, body: op.iban ? `IBAN ${op.iban}${op.bic ? ` · BIC ${op.bic}` : ""}` : t("The account isn't known yet — enter the IBAN once, Zeff keeps it with the contact.") }),
    // Zeff's page with the GiroCode: scan it with your banking app — you send the money yourself.
    href: (op) => `/pay?${new URLSearchParams({ name: op.name, iban: op.iban, ...(op.bic ? { bic: op.bic } : {}), ...(op.amount ? { amount: op.amount } : {}), ...(op.purpose ? { purpose: op.purpose } : {}) })}`,
  }),
];
