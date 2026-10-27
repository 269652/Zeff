/**
 * Runs kept in memory by their id — per account: a run's id is its account's database's (both accounts have a run #5), so
 * one served side by side with another (src/db/accounts.ts, by host) must never see, steer or stop the other's run. Looked
 * up in the account the code runs for unless an account is given; set under the run's own account. Iterating goes over all
 * accounts' runs (the tick that follows them all). No imports: the live drivers that keep their runs here load early —
 * `current` is theirs (currentAccountId). Server only.
 */
export class RunMap<V extends { account?: string }> {
  private readonly m = new Map<string, { id: number; v: V }>();
  private key = (id: number, account: string) => `${account}|${id}`;

  /**
   * `current`: the account the code runs for (currentAccountId). `earlier`: the runs of an earlier map (kept by id only,
   * before runs were per account) — taken over under each one's account.
   */
  constructor(
    private readonly current: () => string,
    earlier?: Map<number, V> | null,
  ) {
    if (earlier && !(earlier instanceof RunMap)) for (const [id, v] of earlier) this.m.set(this.key(id, v.account ?? current()), { id, v });
  }

  get(id: number, account = this.current()): V | undefined {
    return this.m.get(this.key(id, account))?.v;
  }
  has(id: number, account = this.current()): boolean {
    return this.m.has(this.key(id, account));
  }
  /** Kept under the run's own account (its `account`), else the current one. */
  set(id: number, v: V): this {
    this.m.set(this.key(id, v.account ?? this.current()), { id, v });
    return this;
  }
  delete(id: number, account = this.current()): boolean {
    return this.m.delete(this.key(id, account));
  }
  /** The current account's run ids. */
  keys(account = this.current()): IterableIterator<number> {
    return [...this.m.values()].filter((e) => (e.v.account ?? "") === account).map((e) => e.id)[Symbol.iterator]();
  }
  /** Every account's runs (the tick that follows them all). */
  values(): IterableIterator<V> {
    return [...this.m.values()].map((e) => e.v)[Symbol.iterator]();
  }
  get size(): number {
    return this.m.size;
  }
}
