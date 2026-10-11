import { z } from "zod";
import { t } from "@/lib/i18n/server";
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

/** An entry_types key; whether it exists is checked when the entry is saved. */
export const entryTypeSchema = z.string().trim().min(1).max(40);

export const tagNamesSchema = z.array(z.string().trim().min(1).max(40)).max(20);

const projectIdSchema = z.number().int().positive();

export const timeEntryInputSchema = z.object({
  /** The job to book on. Optional when projectId is given (the project's job is used). */
  jobNumber: jobNumberSchema.optional(),
  projectId: projectIdSchema.optional(),
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
  /** A project books the entry on its job; null detaches it (then jobNumber, or the current job, is kept). */
  projectId: projectIdSchema.nullable().optional(),
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

const optionalIsoDate = z.union([isoDateSchema, z.literal("")]).optional();

export const projectInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  customer: z.string().trim().max(200).optional(),
  /** Job number the project books on; empty = no job yet. */
  jobNumber: z.string().trim().max(64).optional(),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  active: z.boolean().optional(),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

/** The messages of the schemas above in the account's language (zod's own stay English). */
const messages = (): Record<string, string> => ({
  "Expected an ISO date in the form YYYY-MM-DD": t("Expected an ISO date in the form YYYY-MM-DD"),
  "Hours must be greater than 0": t("Hours must be greater than 0"),
  "Hours must not exceed 24 for a single entry": t("Hours must not exceed 24 for a single entry"),
  "Job number is required": t("Job number is required"),
  "Job number is too long": t("Job number is too long"),
  "Description is required": t("Description is required"),
  "Description is too long": t("Description is too long"),
  "Name is required": t("Name is required"),
  "Title is required": t("Title is required"),
});

/** Turn a zod error into a single readable line. */
export function formatZodError(err: z.ZodError): string {
  const say = messages();
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${say[i.message] ?? i.message}` : (say[i.message] ?? i.message)))
    .join("; ");
}
