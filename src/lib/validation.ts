import { z } from "zod";
import { isValidIsoDate } from "./week";

export const isoDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoDate, "Expected an ISO date in the form YYYY-MM-DD");

export const hoursSchema = z
  .number()
  .positive("Hours must be greater than 0")
  .max(24, "Hours must not exceed 24 for a single entry");

export const jobNumberSchema = z
  .string()
  .trim()
  .min(1, "Job number is required")
  .max(64, "Job number is too long");

export const entryTypeSchema = z.enum(["ticket", "meeting", "other"]);

export const tagNamesSchema = z.array(z.string().trim().min(1).max(40)).max(20);

export const timeEntryInputSchema = z.object({
  jobNumber: jobNumberSchema,
  date: isoDateSchema,
  hours: hoursSchema,
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(2000, "Description is too long"),
  ticket: z.string().trim().max(100).optional(),
  reportedBy: z.string().trim().max(100).optional(),
  type: entryTypeSchema.optional(),
  tags: tagNamesSchema.optional(),
});

export type TimeEntryInput = z.infer<typeof timeEntryInputSchema>;

export const timeEntryPatchSchema = z.object({
  jobNumber: jobNumberSchema.optional(),
  date: isoDateSchema.optional(),
  hours: hoursSchema.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  ticket: z.string().trim().max(100).nullable().optional(),
  reportedBy: z.string().trim().min(1).max(100).optional(),
  type: entryTypeSchema.optional(),
  tags: tagNamesSchema.optional(),
});

export type TimeEntryPatch = z.infer<typeof timeEntryPatchSchema>;

export const jobInputSchema = z.object({
  number: jobNumberSchema,
  name: z.string().trim().min(1, "Name is required").max(200),
  customer: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  active: z.boolean().optional(),
});

export type JobInput = z.infer<typeof jobInputSchema>;

/** Turn a zod error into a single readable line. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
