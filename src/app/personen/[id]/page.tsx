import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import type { KnowledgeEntityDetail } from "@/plugins/knowledge/shared";
import { addDateFormAction, dateFormAction, deletePersonFormAction, findDatesFormAction, updatePersonFormAction } from "@/plugins/people/server-actions";
import { DATE_KIND_LABELS, DATE_KINDS, dateText, daysBetween, inDaysText, isoDay, nextOccurrence } from "@/plugins/people/shared";
import { contactsOf, datesOf, getPerson, namesThem, rememberEntity } from "@/plugins/people/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Person" };

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Card({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
        <span>{title}</span>
        {extra}
      </h2>
      {children}
    </section>
  );
}

/** What the knowledge knows of them: by the entity kept with the profile, else (or when normalizing merged it away) by name. */
async function knowledgeOf(p: NonNullable<ReturnType<typeof getPerson>>): Promise<{ entity: KnowledgeEntityDetail | null; error: string | null }> {
  if (!isInstalled("knowledge")) return { entity: null, error: null };
  try {
    const { knowledgePerson } = await import("@/plugins/knowledge/client");
    let entity = p.entityId ? await knowledgePerson({ id: p.entityId }) : null;
    if (!entity) for (const n of [p.name, ...p.aliases]) if ((entity = await knowledgePerson({ name: n }))) break;
    if (entity && entity.id !== p.entityId) rememberEntity(p.id, entity.id);
    return { entity, error: null };
  } catch (e) {
    return { entity: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A person: their dates (with reminders; found ones to confirm), your notes, what the knowledge
 * knows of them, their latest messages, the todos naming them — and what they're called (name,
 * aliases, WhatsApp chat, mail addresses), so Zeff finds them.
 */
export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; found?: string }> }) {
  await connection();
  if (!isInstalled("people")) return <PluginNotInstalled id="people" />;
  const p = getPerson(Number((await params).id));
  if (!p) notFound();
  const sp = await searchParams;
  const today = new Date();
  const dates = datesOf(p.id);
  const { entity, error: knowledgeError } = await knowledgeOf(p);
  const contacts = contactsOf(p, 12);
  let todos: { id: number; ref: string; text: string; due: string | null }[] = [];
  if (isInstalled("todos")) {
    const { listTodos } = await import("@/lib/boards/store");
    todos = listTodos({ status: "open" })
      .filter((t) => namesThem(p, `${t.text} ${t.note ?? ""}`))
      .slice(0, 15)
      .map((t) => ({ id: t.id, ref: t.ref, text: t.text, due: t.due }));
  }
  const h = await headers();
  let knowledgeBase = "";
  if (isInstalled("knowledge")) {
    const { knowledgeBrowserUrl } = await import("@/plugins/knowledge/client");
    knowledgeBase = knowledgeBrowserUrl(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
  }
  const back = `/personen/${p.id}`;
  // Relations by whom / what they're with.
  const related = new Map<number, { name: string; type: string; rels: string[] }>();
  for (const r of entity?.relations ?? []) {
    const g = related.get(r.other.id) ?? { name: r.other.name, type: r.other.type, rels: [] };
    const text = r.fact || `${r.dir === "out" ? "→" : "←"} ${r.rel}`;
    if (!g.rels.includes(text) && g.rels.length < 3) g.rels.push(text);
    related.set(r.other.id, g);
  }

  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/personen" className="text-xs text-zinc-500 hover:underline">
          ← Personen
        </Link>
        <div className="flex items-start gap-2">
          <form action={updatePersonFormAction}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="starred" value={p.starred ? "0" : "1"} />
            <button className={`text-xl leading-none ${p.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`} aria-label={p.starred ? "Stern entfernen" : "Stern setzen"}>
              ★
            </button>
          </form>
          <h1 className="text-lg font-semibold break-words">{p.name}</h1>
        </div>
        {p.aliases.length > 0 && <p className="text-xs text-zinc-500">Auch: {p.aliases.join(", ")}</p>}
        {sp.error && <p className="alert-error text-sm">{sp.error}</p>}
        {sp.saved && <p className="alert-ok text-sm">Gespeichert ✓</p>}
        {sp.found !== undefined && <p className="alert-ok text-sm">{sp.found === "0" ? "Keine neuen Daten gefunden." : `${sp.found} Daten gefunden — unten bestätigen.`}</p>}
        <details>
          <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">Name, Aliase, WhatsApp, Mail</summary>
          <form action={updatePersonFormAction} className="mt-2 space-y-2 text-sm">
            <input type="hidden" name="id" value={p.id} />
            <label className="block">
              <span className="label">Name</span>
              <input name="name" defaultValue={p.name} className="input" />
            </label>
            <label className="block">
              <span className="label">Auch genannt (durch Komma)</span>
              <input name="aliases" defaultValue={p.aliases.join(", ")} className="input" />
            </label>
            <label className="block">
              <span className="label">WhatsApp-Chat (sein Name)</span>
              <input name="whatsapp" defaultValue={p.whatsapp} className="input" />
            </label>
            <label className="block">
              <span className="label">Mail-Adressen (durch Komma)</span>
              <input name="emails" defaultValue={p.emails.join(", ")} className="input" />
            </label>
            <button className="btn btn-primary btn-sm">Speichern</button>
          </form>
          <form action={deletePersonFormAction} className="mt-3">
            <input type="hidden" name="id" value={p.id} />
            <button className="btn btn-sm text-red-700 dark:text-red-400">Profil löschen</button>
          </form>
        </details>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Daten"
          extra={
            <form action={findDatesFormAction}>
              <input type="hidden" name="personId" value={p.id} />
              <button className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400" title="In den Fakten und (mit dem LLM-Plugin) per KI im Wissen und in den Nachrichten">
                Daten finden
              </button>
            </form>
          }
        >
          {dates.length ? (
            <ul className="space-y-2">
              {dates.map((d) => {
                const on = nextOccurrence(d, today);
                const inDays = on ? daysBetween(today, on) : null;
                return (
                  <li key={d.id} className={`space-y-1 text-sm ${d.confirmed ? "" : "rounded-md bg-amber-50 p-2 dark:bg-amber-950/40"}`}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{d.kind === "other" ? d.label || "Datum" : DATE_KIND_LABELS[d.kind]}</span>
                      <span className="tabular-nums">{dateText(d)}</span>
                      {on && inDays !== null && (
                        <span className="text-xs text-zinc-500">
                          {inDaysText(inDays, isoDay(on))}
                          {d.year && d.yearly && d.kind === "birthday" ? ` · wird ${on.getFullYear() - d.year}` : ""}
                        </span>
                      )}
                      {!d.confirmed && <span className="text-xs text-amber-700 dark:text-amber-400">gefunden — stimmt es?</span>}
                    </div>
                    {d.sourceText && <p className="text-xs text-zinc-500">{d.sourceText}</p>}
                    <form action={dateFormAction} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="to" value={back} />
                      {!d.confirmed && (
                        <button name="op" value="confirm" className="btn btn-primary btn-sm">
                          Stimmt
                        </button>
                      )}
                      {d.confirmed && (
                        <>
                          <span className="text-zinc-500">erinnern</span>
                          <input name="remindDays" type="number" min={0} max={60} defaultValue={d.remindDays} className="input w-16 py-0.5 text-xs" aria-label="Tage vorher erinnern" />
                          <span className="text-zinc-500">Tage vorher</span>
                          <button name="op" value="remind" className="btn btn-sm">
                            OK
                          </button>
                        </>
                      )}
                      <button name="op" value="delete" className="btn btn-sm">
                        {d.confirmed ? "Löschen" : "Falsch"}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Noch kein Datum — trag eins ein oder lass Zeff suchen („Daten finden“).</p>
          )}
          <form action={addDateFormAction} className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
            <input type="hidden" name="personId" value={p.id} />
            <select name="kind" className="input w-auto" aria-label="Art">
              {DATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DATE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input name="date" required placeholder="16.10. oder 16.10.1996" className="input w-40" aria-label="Datum" />
            <input name="label" placeholder="wofür (bei „Datum“)" className="input min-w-32 flex-1" aria-label="Bezeichnung" />
            <button className="btn btn-sm">Hinzufügen</button>
          </form>
        </Card>

        <Card title="Notizen">
          <form action={updatePersonFormAction} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <textarea name="note" defaultValue={p.note} rows={Math.min(14, Math.max(4, p.note.split("\n").length + 1))} placeholder="Was du dir über sie merken willst — Vorlieben, Geschenkideen, worüber ihr zuletzt gesprochen habt …" className="input resize-y text-sm" />
            <button className="btn btn-sm">Speichern</button>
          </form>
        </Card>

        {isInstalled("knowledge") && (
          <Card
            title="Was das Wissen weiß"
            extra={
              entity && knowledgeBase ? (
                <a href={`${knowledgeBase}/graph?e=${entity.id}`} target="_blank" rel="noreferrer" className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400">
                  Im Graphen ↗
                </a>
              ) : undefined
            }
          >
            {knowledgeError && <p className="text-xs text-amber-700 dark:text-amber-400">{knowledgeError}</p>}
            {entity ? (
              <>
                {entity.summary && <p className="text-sm">{entity.summary}</p>}
                {related.size > 0 && (
                  <ul className="space-y-1 text-sm">
                    {[...related.entries()].slice(0, 15).map(([id, g]) => (
                      <li key={id}>
                        <span className="font-medium">{g.name}</span>
                        {g.rels.map((r, i) => (
                          <span key={i} className="block text-xs text-zinc-500">
                            {r}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {entity.pages.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-zinc-500">{entity.pages.length} Seiten</summary>
                    <ul className="mt-1 space-y-1 text-sm">
                      {entity.pages.slice(0, 30).map((pg) => (
                        <li key={pg.id}>
                          <a href={`${knowledgeBase}/seite/${encodeURIComponent(pg.id)}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                            {pg.title}
                          </a>{" "}
                          <span className="text-xs text-zinc-400">{pg.space}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              !knowledgeError && <p className="text-sm text-zinc-500">Das Wissen kennt niemanden dieses Namens. Ein Alias, wie die Person in deinen Seiten heißt, hilft.</p>
            )}
          </Card>
        )}

        <Card title="Letzte Nachrichten">
          {contacts.length ? (
            <ul className="space-y-1.5 text-sm">
              {contacts.map((c) => (
                <li key={c.key}>
                  <div className="flex items-baseline gap-2 text-xs text-zinc-500">
                    <span>{c.folder}</span>
                    <span>{c.who}</span>
                    <span className="ml-auto">{when(c.at)}</span>
                  </div>
                  <p className="line-clamp-2">{c.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Keine Nachrichten — trag oben den WhatsApp-Chat oder die Mail-Adressen ein.</p>
          )}
        </Card>

        {isInstalled("todos") && (
          <Card title="Todos, in denen sie vorkommen">
            {todos.length ? (
              <ul className="space-y-1.5 text-sm">
                {todos.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2">
                    <Link href={`/t/${t.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
                      {t.ref}
                    </Link>
                    <span className="min-w-0 flex-1">{t.text}</span>
                    {t.due && <span className="shrink-0 text-xs text-zinc-500">{t.due.slice(8, 10)}.{t.due.slice(5, 7)}.</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Kein offenes Todo nennt sie.</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
