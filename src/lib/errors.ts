/** Thrown when a referenced record does not exist. */
export class NotFoundError extends Error {
  readonly name = "NotFoundError";
}

/** Thrown when a write conflicts with existing data (duplicate number, job still in use, …). */
export class ConflictError extends Error {
  readonly name = "ConflictError";
}

/** Thrown when input fails validation. */
export class ValidationError extends Error {
  readonly name = "ValidationError";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
