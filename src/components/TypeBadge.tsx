import { typeColorStyle, typeDef, type EntryTypeDef } from "@/lib/entry-types-shared";

/** An entry type as a badge in its configured name and color. */
export function TypeBadge({ type, types }: { type: string; types: Record<string, EntryTypeDef> }) {
  const t = typeDef(types, type);
  return (
    <span className="badge badge-type" style={typeColorStyle(t.color)}>
      {t.label}
    </span>
  );
}
