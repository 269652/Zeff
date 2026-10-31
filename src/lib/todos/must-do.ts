import { isChatFolder } from "@/lib/mail/shared";

/** Must-do mails, by their words (no AI): never left without a todo, never held back by what you dropped or a learned rule. */

/** A training or course (in German or English). */
const TRAINING = /(pflicht|compliance|mandatory|required|obligatory|verpflichtend)[\s\S]{0,80}(schulung|training|kurs|course|e-?learning|modul|module)|(schulung|training|kurs|course|e-?learning)[\s\S]{0,80}(pflicht|mandatory|required|obligatory|verpflichtend)|course pending|kurs ausstehend|not yet completed the (mandatory )?(course|training)/i;
/** …asked of you: a reminder, a deadline, overdue, still to do. */
const DUE = /(reminder|erinnerung|frist|deadline|due|overdue|überfällig|fällig|pending|ausstehend|not yet completed|noch nicht (abgeschlossen|absolviert|erledigt)|please complete|bitte (absolvieren|abschließen))/i;
/** A document waiting for your signature. */
const SIGNATURE = /(warten auf (deine|ihre) (signatur|unterschrift)|waiting for (your )?signature|bitte (signiere|unterschreibe|unterzeichne)|please (sign|review and sign)|signatur(anfrage)? (angefordert|erforderlich)|signature (requested|required)|docusign|acrobat sign|adobe ?sign)/i;

/**
 * A mail you must act on — a mandatory training or course with a reminder or deadline, a document
 * waiting for your signature: never left without a todo (the AI is told so, and Zeff makes one when
 * it doesn't). Recognized by its words, not by the AI.
 */
export function mustDo(m: { fromName: string | null; fromEmail: string | null; subject: string; preview: string; folder: string }): boolean {
  if (isChatFolder(m.folder)) return false;
  const text = `${m.subject}\n${m.preview}`;
  if (TRAINING.test(text) && DUE.test(text)) return true;
  return SIGNATURE.test(`${m.fromName ?? ""} ${m.fromEmail ?? ""}\n${text}`) && /(sign|signatur|unterschr|unterzeichn)/i.test(text);
}
