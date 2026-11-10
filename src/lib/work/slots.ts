/**
 * The workers' slots: the general ones (Settings → Code, "Workers at once") and slots reserved for one todo source on
 * top of them (a plugin's own pool, e.g. Learn's lessons — "Zeff-Chat:learn"). A reserved slot only takes runs of its
 * source; a run of that source takes a reserved slot first, then a general one. So Learn's reserved worker never holds
 * up a Code run, and a busy Code queue never holds up a lesson.
 */

/** Most slots reserved per source (each one is a Claude session more at once). */
export const MAX_RESERVED = 4;
/** Most general workers at once. */
export const MAX_PARALLEL = 16;

export const clampParallel = (n: number) => Math.min(MAX_PARALLEL, Math.max(1, Math.round(n) || 1));
export const clampReserved = (n: number) => Math.min(MAX_RESERVED, Math.max(0, Math.round(n) || 0));

/** Reserved slots by todo source — only sources with at least one. */
export function cleanReserved(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [source, n] of Object.entries(raw as Record<string, unknown>)) {
    const v = clampReserved(Number(n));
    if (source && v > 0) out[source] = v;
  }
  return out;
}

/**
 * Who holds which slot right now, and taking one for the next run. `running`: the sources of the runs that hold a
 * worker (null: a run without a todo source).
 */
export class SlotPool {
  private general: number;
  private spare = new Map<string, number>();

  constructor(parallel: number, reserved: Record<string, number>, running: (string | null)[]) {
    const held = new Map<string, number>();
    let generalUsed = 0;
    for (const source of running) {
      const r = source ? (reserved[source] ?? 0) : 0;
      const n = source ? (held.get(source) ?? 0) : 0;
      // A run of a source with reserved slots sits in one of them while there are; past them it holds a general one.
      if (source && n < r) held.set(source, n + 1);
      else generalUsed++;
    }
    this.general = parallel - generalUsed;
    for (const [source, r] of Object.entries(reserved)) this.spare.set(source, Math.max(0, r - (held.get(source) ?? 0)));
  }

  /** Free slots in all: none — nothing queued can start. */
  get free(): number {
    return Math.max(0, this.general) + [...this.spare.values()].reduce((a, b) => a + b, 0);
  }

  /** Free for a run of this source (its reserved slots, then the general ones). */
  freeFor(source: string | null): number {
    return Math.max(0, this.general) + (source ? (this.spare.get(source) ?? 0) : 0);
  }

  /** Free among this source's reserved slots only. */
  reservedFree(source: string): number {
    return this.spare.get(source) ?? 0;
  }

  /** A slot taken for a run of this source — false: none free for it. */
  take(source: string | null): boolean {
    const r = source ? (this.spare.get(source) ?? 0) : 0;
    if (source && r > 0) {
      this.spare.set(source, r - 1);
      return true;
    }
    if (this.general > 0) {
      this.general--;
      return true;
    }
    return false;
  }
}
