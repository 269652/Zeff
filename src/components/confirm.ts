/**
 * Ask before something that can't be taken back (a delete, an install, a restore). One place for
 * it so the browser's confirm box can be swapped for a dialog later without touching the callers.
 * Client-side only; on the server there is nobody to ask, so the answer is no.
 */
export function confirmAction(question: string): boolean {
  return typeof window !== "undefined" && window.confirm(question);
}
