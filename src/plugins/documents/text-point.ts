import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * What other plugins say a document's text is, in place of what was read (Revolut: a statement is a note of what it is, not
 * its bookings — they would reach the knowledge, the people and the cases as if they were letters). The first that gives a
 * text wins; null: the document's own text. Server only.
 */
export type DocumentText = (name: string, text: string) => string | null;

export const documentTexts = extensionPoint<DocumentText>("documents.texts");
