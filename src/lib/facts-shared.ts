/** A fact of yours (client-safe): what it's about, what's true, where it comes from. */
export type FactView = { id: number; ref: string; subject: string; text: string; refs: string[]; createdAt: string; updatedAt: string };

/** "fact:12" */
export const factRef = (id: number) => `fact:${id}`;
