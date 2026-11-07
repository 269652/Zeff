import type { T } from "@/lib/i18n/shared";
import type { MailMethod, ProviderId } from "../presets";

/**
 * The words the mail account pages share: a way of reading a mailbox, and what to know about a provider before signing in.
 * Literals inside t() so the translation check finds them. Client-safe.
 */

export const methodLabel = (t: T, m: MailMethod): string =>
  m === "api" ? t("Through its API (OAuth)") : m === "browser" ? t("Browser automation (automation Chrome)") : m === "imap" ? t("IMAP (folders, read state)") : t("POP3 (only the inbox)");

export const methodHint = (t: T, m: MailMethod): string =>
  m === "api"
    ? t("The stable way: signed in once with your own OAuth client on the Connections page; read in the background.")
    : m === "browser"
      ? t("Read in the automation Chrome, where you are signed in — nothing to set up, but Chrome has to run.")
      : m === "imap"
        ? t("Like a mail program: address and password; reads the folders you choose and the Sent folder, sends over SMTP.")
        : t("Only the inbox, read once and kept — for providers without IMAP. Nothing is deleted on the server; sends over SMTP.");

export function providerNote(t: T, p: ProviderId, m: MailMethod): string | null {
  if (m === "api" || m === "browser") return null;
  if (p === "t-online")
    return t("T-Online needs its own password for mail programs, not your Telekom login password: in the Telekom E-Mail Center under Settings → Passwords → “Password for e-mail programs” (E-Mail-Passwort).");
  if (p === "gmx") return t("GMX: switch on “POP3/IMAP access” once in GMX's mail settings first.");
  if (p === "web-de") return t("WEB.DE: switch on “POP3/IMAP access” once in WEB.DE's mail settings first.");
  if (p === "gmail") return t("Gmail: sign in with an app password (Google account → Security → 2-Step Verification → App passwords); your Google password doesn't work here.");
  if (p === "outlook") return t("Microsoft has turned off password sign-in for many accounts: if the test is refused, use “Through its API” instead.");
  return t("Your provider's help pages list its IMAP and SMTP servers (“mail program settings”).");
}
