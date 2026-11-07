import { redirect } from "@/lib/redirect";

/** The single IMAP mailbox's page of before: the mail accounts are all on Settings → E-Mail now. */
export default function ImapSettingsPage(): never {
  redirect("/settings/mail");
}
