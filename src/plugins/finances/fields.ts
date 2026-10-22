/** The debts database's fixed field ids (the Finances plugin) — the cases' records and your own rows share them. Client-safe. */
export const DEBT = { dir: "debtdir", creditor: "debtcreditor", collector: "debtcollector", total: "debttotal", open: "debtopen", rate: "debtrate", due: "debtdue", day: "debtday", case: "debtcase", next: "debtnext", claim: "debtclaim" } as const;
