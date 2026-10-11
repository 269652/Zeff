import { getPref } from "@/lib/prefs";

/** The Documents plugin's settings (per account): the audio transcriber, and whether Poppler may be installed by itself. */
export type DocumentSettings = { transcriber: string; autoInstall: boolean };

export const documentSettings = (): DocumentSettings => ({ transcriber: "", autoInstall: true, ...getPref<Partial<DocumentSettings>>("plugin:documents", {}) });
