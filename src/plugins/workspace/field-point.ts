import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * Field types plugins give the Workspace's databases: a field whose entries are checked and put into shape by the plugin (a rating, a
 * percentage, a ticket key, a country) and shown the way it says - as text, stars, a bar, a badge or a link. A plugin names its types and
 * gives a function that turns an entry into what is kept; the Workspace stores, sorts, filters, exports and draws every one alike.
 * Server only (the client gets the info below).
 */
export type WorkspaceFieldType = {
  /** "<plugin>.<what>" - unique; kept in the property. */
  id: string;
  label: string;
  icon: string;
  /** One line: what it holds. */
  description: string;
  /** How a value is drawn: as text, stars (up to `max`), a bar (0-100), a badge, or a link (`href` with {value} in it). */
  display: "text" | "rating" | "progress" | "badge" | "link";
  max?: number;
  href?: string;
  /** What is kept for an entry (a text, a number; null clears it). Throws to refuse an entry that does not fit. */
  parse: (input: string) => string | number | null;
  /** Values offered while typing. */
  suggestions?: () => string[];
};

/** What the page needs to draw a field type and take an entry for it. */
export type FieldTypeInfo = { id: string; label: string; icon: string; description: string; display: WorkspaceFieldType["display"]; max?: number; href?: string; suggestions: string[] };

export const workspaceFieldTypes = extensionPoint<WorkspaceFieldType[]>("workspace.fieldTypes");

/** The field types of external plugins (set by the Workspace's server.ts: the plugin registry must not be loaded while this file is). */
export let externalFieldTypes: () => WorkspaceFieldType[] = () => [];
export const setExternalFieldTypes = (f: () => WorkspaceFieldType[]): void => {
  externalFieldTypes = f;
};
