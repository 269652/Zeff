"use server";

/** Privacy → What went to the AI: the text a receipt kept (lib/ai/receipts.ts). */
export async function receiptTextAction(id: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const text = (await import("@/lib/ai/receipts")).receiptText(Number(id));
  return text === null ? { ok: false, error: "gone" } : { ok: true, text };
}
