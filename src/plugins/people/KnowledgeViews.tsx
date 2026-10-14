import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { claimsOf, linksOf, openCommitments, proposedClaims, proposedLinks, staleClaims, type Claim, type Link as PersonLink } from "./graph";
import { reviewKnowledgeFormAction } from "./server-actions";

/** Claims and links about people, for review (the People page) and per person (their page). Server components. */

const kindLabel = (k: Claim["kind"]) => ({ fact: t("Fact"), role: t("Role"), owns: t("Responsible for"), preference: t("Preference"), commitment: t("Commitment") })[k];
const relLabel = (r: PersonLink["rel"]) =>
  ({
    "reports-to": t("reports to"),
    manages: t("manages"),
    "works-with": t("works with"),
    decides: t("decides on"),
    owns: t("is responsible for"),
    "on-ticket": t("is on"),
    "commented-on": t("commented on"),
    authored: t("wrote in"),
    "active-in": t("is active in"),
    "knows-about": t("knows about"),
  })[r];

/** Where a claim came from, as a short label. */
const sourceLabel = (ref: string) => (ref.startsWith("mail:") ? t("Mail/chat") : ref.startsWith("teams:") ? "Teams" : ref.startsWith("jira") ? "Jira" : ref.startsWith("gitlab") ? "GitLab" : "");

function Buttons({ id, what, to, yes = "Right", no = "Wrong", yesOp = "confirm" }: { id: number; what: "claim" | "link"; to: string; yes?: "Right" | "Still true" | "Done"; no?: "Wrong" | "Outdated"; yesOp?: "confirm" | "recheck" | "done" }) {
  const label = { Right: t("Right"), "Still true": t("Still true"), Done: t("Done"), Wrong: t("Wrong"), Outdated: t("Outdated") };
  return (
    <form action={reviewKnowledgeFormAction} className="flex shrink-0 gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="what" value={what} />
      <input type="hidden" name="to" value={to} />
      <button name="op" value={yesOp} className="btn btn-primary btn-sm">
        {label[yes]}
      </button>
      <button name="op" value="reject" className="btn btn-sm">
        {label[no]}
      </button>
    </form>
  );
}

const pct = (c: number) => `${Math.round(c * 100)}%`;

function Quote({ evidence, source, confidence }: { evidence: string; source: string; confidence: number }) {
  return (
    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={evidence}>
      {evidence && <>“{evidence}” · </>}
      {sourceLabel(source) && <>{sourceLabel(source)} · </>}
      {pct(confidence)}
    </span>
  );
}

/** The review queue of the People page: what the AI proposes, what has aged, what is owed. */
export function KnowledgeReview({ to = "/personen" }: { to?: string }) {
  const claims = proposedClaims().filter((c) => c.kind !== "commitment" || !c.doneAt);
  const links = proposedLinks();
  const stale = staleClaims();
  const owed = openCommitments();
  if (!claims.length && !links.length && !stale.length && !owed.length) return null;
  return (
    <>
      {owed.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Open commitments")}</h2>
          <ul className="space-y-1.5">
            {owed.slice(0, 20).map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className={`shrink-0 rounded px-1.5 text-xs ${c.direction === "mine" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"}`}>{c.direction === "mine" ? t("I owe") : t("They owe")}</span>
                <Link href={`/personen/${c.personId}`} className="font-medium hover:underline">
                  {c.personName}
                </Link>
                <span className="min-w-0 flex-1">{c.text}</span>
                {c.due && <span className="shrink-0 text-xs text-zinc-500">{c.due}</span>}
                <form action={reviewKnowledgeFormAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="to" value={to} />
                  <button name="op" value="done" className="btn btn-sm">
                    {t("Done")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(claims.length > 0 || links.length > 0) && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Read from your messages — are they right?")}</h2>
          <ul className="space-y-2">
            {claims.slice(0, 30).map((c) => (
              <li key={`c${c.id}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Link href={`/personen/${c.personId}`} className="font-medium hover:underline">
                  {c.personName}
                </Link>
                <span className="text-xs text-zinc-400">{kindLabel(c.kind)}</span>
                <span className="min-w-0">{c.text}</span>
                <Quote evidence={c.evidence} source={c.sourceRef} confidence={c.confidence} />
                <Buttons id={c.id} what="claim" to={to} />
              </li>
            ))}
            {links.slice(0, 30).map((l) => (
              <li key={`l${l.id}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Link href={`/personen/${l.personId}`} className="font-medium hover:underline">
                  {l.personName}
                </Link>
                <span className="min-w-0">
                  {relLabel(l.rel)} {l.targetType === "person" ? <LinkedPerson id={l.targetRef} /> : <span className="font-medium">{l.targetRef}</span>}
                </span>
                <Quote evidence={l.evidence} source={l.sourceRef} confidence={l.confidence} />
                <Buttons id={l.id} what="link" to={to} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {stale.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Still true?")}</h2>
          <ul className="space-y-2">
            {stale.slice(0, 20).map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Link href={`/personen/${c.personId}`} className="font-medium hover:underline">
                  {c.personName}
                </Link>
                <span className="min-w-0 flex-1">{c.text}</span>
                <Buttons id={c.id} what="claim" to={to} yes="Still true" no="Outdated" yesOp="recheck" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function personName(id: string): Promise<string> {
  const { getPerson } = await import("./store");
  return getPerson(Number(id))?.name ?? "?";
}

async function LinkedPerson({ id }: { id: string }) {
  return (
    <Link href={`/personen/${id}`} className="font-medium hover:underline">
      {await personName(id)}
    </Link>
  );
}

/** One person's claims and links (their page): what is known, with the quote and where it came from. */
export async function PersonKnowledge({ personId }: { personId: number }) {
  const to = `/personen/${personId}`;
  const claims = claimsOf(personId);
  const links = linksOf(personId);
  const names = new Map<string, string>();
  for (const l of links) if (l.targetType === "person") names.set(l.targetRef, await personName(l.targetRef));
  if (!claims.length && !links.length) return <p className="text-xs text-zinc-400">{t("Nothing read from your messages yet — Zeff reads new ones after each briefing.")}</p>;
  return (
    <div className="space-y-2">
      {claims.length > 0 && (
        <ul className="space-y-1.5">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-xs text-zinc-400">{kindLabel(c.kind)}</span>
              <span className={`min-w-0 ${c.doneAt ? "text-zinc-400 line-through" : ""}`}>
                {c.text}
                {c.kind === "commitment" && c.due ? ` · ${c.due}` : ""}
              </span>
              {c.status === "confirmed" ? <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span> : <Quote evidence={c.evidence} source={c.sourceRef} confidence={c.confidence} />}
              {c.status === "proposed" && <Buttons id={c.id} what="claim" to={to} />}
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {links.map((l) => (
            <li key={l.id} className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-700" title={l.evidence}>
              {relLabel(l.rel)} <span className="font-medium">{l.targetType === "person" ? (names.get(l.targetRef) ?? "?") : l.targetRef}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
