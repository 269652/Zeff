import { z } from "zod";
import { manifestSchema } from "./manifest";

/** The manifest's JSON Schema, as the file docs/plugins/zeff-plugin.schema.json has it. */
export function manifestJsonSchema(): string {
  const schema = z.toJSONSchema(manifestSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return `${JSON.stringify({ title: "Zeff plugin manifest (zeff-plugin.json)", ...schema }, null, 2)}\n`;
}
