import { t } from "@/lib/i18n/server";
import type { DocNode } from "@/plugins/workspace/doc";

/**
 * What a person's page starts with (after its view block): a short intro line, then their todos, what is coming up, the facts
 * and your rhythm — the person widgets without a header, each taking the page's person by itself. Server only.
 */
export const PERSON_PAGE_WIDGETS = ["people.todos", "people.coming", "people.facts", "people.rhythm"];

export const personPageLayout = (): DocNode[] => [
  { type: "paragraph", content: [{ type: "text", text: t("What is open with them, what is coming up, what Zeff knows — your own notes go anywhere below.") }] },
  ...PERSON_PAGE_WIDGETS.map((widget): DocNode => ({ type: "zeffWidget", attrs: { widget, config: "{}", title: "", header: "hide" } })),
];
