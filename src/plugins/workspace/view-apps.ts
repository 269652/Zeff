import { CALENDAR_VIEW } from "@/plugins/calendar/view-template.meta";
import { CASES_VIEW } from "@/plugins/cases/view-template.meta";
import { DOCUMENTS_VIEW } from "@/plugins/documents/view-template.meta";
import { DEBTS_VIEW } from "@/plugins/finances/view-template.meta";
import { CHAT_VIEW, INBOX_VIEW, MAIL_VIEW } from "@/plugins/mail-client/view-template.meta";
import { PEOPLE_VIEW } from "@/plugins/people/view-template.meta";
import type { T } from "@/lib/i18n/shared";
import type { ActionMeta, PartMeta } from "./view-template";

/**
 * The views drawn from a template (view-template.ts): each app's (its parts, its own actions, what its template reads as app.*, its
 * default template) — and "template", a view of any table built from its template alone. Client-safe: the page draws with it, the AI
 * reads it to write a view.
 */
export type ViewAppMeta = {
  app: string;
  label: string;
  parts: PartMeta[];
  actions: ActionMeta[];
  /** What app.* holds (for the AI and the help): "app.open: the money open …". */
  appData: string;
  /** The view as it comes — its labels in the language shown (t: the i18n bundles'). */
  defaultTemplate: (t: T) => string;
};

/** A view of any table: its title, a search, New — and the rows as a table. */
export const TEMPLATE_VIEW: ViewAppMeta = {
  app: "template",
  label: "Template",
  parts: [],
  actions: [],
  appData: "",
  defaultTemplate: (t) =>
    [
      '<state name="q" value=""/>',
      `<row gap=2><heading level=2>{{ db.title }}</heading><grow/><search bind="q" placeholder="${t("Search …")}"/><button action="new" label="${t("New")}" variant=primary/></row>`,
      '<table source="rows | search(state.q)"/>',
    ].join("\n"),
};

const ALL: ViewAppMeta[] = [TEMPLATE_VIEW, DEBTS_VIEW, CASES_VIEW, PEOPLE_VIEW, CALENDAR_VIEW, DOCUMENTS_VIEW, MAIL_VIEW, CHAT_VIEW, INBOX_VIEW];

export const viewAppMeta = (app: string): ViewAppMeta | undefined => ALL.find((m) => m.app === app);
