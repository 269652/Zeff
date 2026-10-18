import { workspaceFieldTypes, type FieldTypeInfo, type WorkspaceFieldType } from "./field-point";

/** The field types of the installed plugins (and the Workspace's own: a rating, a percentage). Server only. */
export function fieldTypes(): WorkspaceFieldType[] {
  return workspaceFieldTypes.list().flatMap((c) => c.impl);
}

export const fieldType = (id: string | undefined): WorkspaceFieldType | undefined => (id ? fieldTypes().find((f) => f.id === id) : undefined);

/** What the page gets of them. */
export function fieldTypeInfos(): FieldTypeInfo[] {
  return fieldTypes().map((f) => {
    let suggestions: string[] = [];
    try {
      suggestions = f.suggestions?.().slice(0, 200) ?? [];
    } catch {
      // no suggestions then
    }
    return { id: f.id, label: f.label, icon: f.icon, description: f.description, display: f.display, max: f.max, href: f.href, suggestions };
  });
}

/** An entry put into shape by its field type - null when the type is gone, the entry does not fit, or it is empty. */
export function parseCustom(typeId: string | undefined, v: unknown): string | number | null {
  const ft = fieldType(typeId);
  if (!ft) return typeof v === "number" ? v : typeof v === "string" ? v.trim().slice(0, 500) || null : null;
  try {
    return ft.parse(typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  } catch {
    return null;
  }
}

const whole = (input: string, lo: number, hi: number, what: string): number | null => {
  if (input === "") return null;
  const n = Number(input.replace(",", "."));
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${what}: ${lo}-${hi}`);
  return Math.round(n);
};

/** What the Workspace brings itself. */
export const CORE_FIELD_TYPES: WorkspaceFieldType[] = [
  { id: "workspace.rating", label: "Rating", icon: "⭐", description: "1 to 5 stars", display: "rating", max: 5, parse: (s) => whole(s, 0, 5, "Rating") || null },
  { id: "workspace.progress", label: "Progress", icon: "▰", description: "0 to 100 percent, drawn as a bar", display: "progress", parse: (s) => whole(s, 0, 100, "Progress") },
];
