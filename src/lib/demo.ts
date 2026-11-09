/**
 * The demo: Zeff with sample data, to look around in before setting anything up — an account of its own ("Demo", its own
 * database) with mails, chats, people, appointments and the todos Zeff would have derived from them, each with its sources,
 * its reason and a ready action. Nothing syncs there and no action leaves it (accounts.ts `demo`, sync/registry.ts, ops.ts).
 * Server only.
 */
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { accountById, addAccount, accountsInstalled, DEFAULT_ACCOUNT, listAccounts, setAccountsInstalled, withAccount } from "@/db/accounts";
import { localDay, localStamp } from "@/lib/dates";
import { getLanguage } from "@/lib/i18n/server";

type Lang = "de" | "en";
type Text = Record<Lang, string>;
const pick = (lang: Lang, v: Text) => v[lang];

/** A day from today ("+2": the day after tomorrow) — and a local time on it. */
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDay(d);
};
const at = (offset: number, hh: number, mm = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hh, mm, 0, 0);
  return d;
};
const iso = (offset: number, hh: number, mm = 0) => at(offset, hh, mm).toISOString();

/** The sample mails and chat messages (Gmail and WhatsApp — the folders the inbox knows). */
type DemoMessage = { id: string; conv: string; folder: "Gmail" | "WhatsApp"; from: string; email: string | null; subject: Text; body: Text; when: string; unread: boolean };

const MESSAGES = (): DemoMessage[] => [
  {
    id: "landlord",
    conv: "gmail:demo-landlord",
    folder: "Gmail",
    from: "Thomas Berger",
    email: "t.berger@example.com",
    subject: { de: "Zählerstand bis Freitag", en: "Meter reading by Friday" },
    body: {
      de: "Hallo,\n\nfür die Nebenkostenabrechnung brauche ich bis Freitag den Zählerstand Ihres Wasserzählers. Ein Foto genügt.\n\nVielen Dank und viele Grüße\nThomas Berger",
      en: "Hello,\n\nfor the utilities statement I need the reading of your water meter by Friday. A photo is enough.\n\nThanks and best regards\nThomas Berger",
    },
    when: iso(-1, 9, 12),
    unread: true,
  },
  {
    id: "lena",
    conv: "gmail:demo-lena",
    folder: "Gmail",
    from: "Lena Hoffmann",
    email: "lena.hoffmann@example.com",
    subject: { de: "Folien für Donnerstag?", en: "Slides for Thursday?" },
    body: {
      de: "Hi!\n\nSchickst du mir deine drei Folien für die Präsentation am Donnerstag bis Mittwochabend? Dann baue ich alles zusammen.\n\nDanke dir!\nLena",
      en: "Hi!\n\nCould you send me your three slides for Thursday's presentation by Wednesday evening? Then I'll put everything together.\n\nThanks!\nLena",
    },
    when: iso(-1, 16, 40),
    unread: true,
  },
  {
    id: "dentist",
    conv: "gmail:demo-dentist",
    folder: "Gmail",
    from: "Praxis Dr. Weber",
    email: "termine@praxis-weber.example",
    subject: { de: "Ihr Termin zur Kontrolle", en: "Your check-up appointment" },
    body: {
      de: "Guten Tag,\n\nwir haben für Sie einen Kontrolltermin reserviert. Bitte bestätigen Sie ihn kurz per Antwort auf diese Mail.\n\nIhr Praxisteam",
      en: "Hello,\n\nwe have reserved a check-up appointment for you. Please confirm it briefly by replying to this mail.\n\nYour practice team",
    },
    when: iso(-2, 11, 5),
    unread: false,
  },
  {
    id: "insurance",
    conv: "gmail:demo-insurance",
    folder: "Gmail",
    from: "Hausrat Direkt",
    email: "service@hausrat-direkt.example",
    subject: { de: "Rechnung Nr. 2026-4471: 84,20 €", en: "Invoice no. 2026-4471: €84.20" },
    body: {
      de: "Ihr Jahresbeitrag zur Hausratversicherung über 84,20 € ist am " + day(6) + " fällig. IBAN DE12 5001 0517 0648 4898 90, Verwendungszweck 2026-4471.",
      en: "Your annual home contents insurance premium of €84.20 is due on " + day(6) + ". IBAN DE12 5001 0517 0648 4898 90, reference 2026-4471.",
    },
    when: iso(-3, 8, 30),
    unread: false,
  },
  {
    id: "newsletter",
    conv: "gmail:demo-newsletter",
    folder: "Gmail",
    from: "Bücherwurm Newsletter",
    email: "news@buecherwurm.example",
    subject: { de: "Die Neuerscheinungen der Woche", en: "This week's new releases" },
    body: {
      de: "Zehn Bücher, die Sie diesen Herbst nicht verpassen sollten …",
      en: "Ten books you shouldn't miss this autumn …",
    },
    when: iso(0, 7, 0),
    unread: true,
  },
  {
    id: "jonas",
    conv: "wa:Jonas",
    folder: "WhatsApp",
    from: "Jonas",
    email: null,
    subject: { de: "Jonas", en: "Jonas" },
    body: {
      de: "Kommst du Samstag zum Grillen? 18 Uhr bei uns. Bringst du einen Salat mit? 😄",
      en: "Coming to the barbecue on Saturday? 6 pm at ours. Could you bring a salad? 😄",
    },
    when: iso(0, 8, 47),
    unread: true,
  },
  {
    id: "mum",
    conv: "wa:Mama",
    folder: "WhatsApp",
    from: "Mama",
    email: null,
    subject: { de: "Mama", en: "Mum" },
    body: {
      de: "Denkst du an Omas Geburtstag am Sonntag? Sie freut sich bestimmt über einen Anruf ❤️",
      en: "Don't forget Grandma's birthday on Sunday! She'd love a call ❤️",
    },
    when: iso(-1, 19, 20),
    unread: false,
  },
  {
    id: "jonas-earlier",
    conv: "wa:Jonas",
    folder: "WhatsApp",
    from: "Jonas",
    email: null,
    subject: { de: "Jonas", en: "Jonas" },
    body: { de: "Danke fürs Buch, hab's schon halb durch!", en: "Thanks for the book, already halfway through!" },
    when: iso(-4, 21, 3),
    unread: false,
  },
];

/** The sample data, written into the database this runs for (the demo account's). */
export async function seedDemo(lang: Lang): Promise<void> {
  const { setInstalled } = await import("@/plugins/state");
  const { updateAppSettings } = await import("@/lib/ai");
  const { saveMails } = await import("@/lib/mail/store");
  // What the demo shows: the inbox (Gmail, WhatsApp), the Workspace, people, the calendar and the timeline — no AI, no Chrome.
  for (const id of ["todos", "workspace", "mail-client", "gmail", "whatsapp", "calendar", "people", "timeline", "learn"]) setInstalled(id, true);
  // What is on by default but would only show empty or ask for a sign-in here (work sources, the AI backends).
  for (const id of ["outlook", "outlook-mail", "outlook-calendar", "teams", "jira", "jira-lage", "tickets", "gitlab", "work", "work-elevated", "llm", "auto-actions", "claude-cli", "codex-cli", "copilot-cli", "google-calendar", "imap-mail", "knowledge", "knowledge-hub", "zeiterfassung"]) {
    try {
      setInstalled(id, false);
    } catch {
      // not a plugin of this build
    }
  }
  updateAppSettings({ setupDoneAt: new Date().toISOString() });

  const messages = MESSAGES();
  saveMails(
    messages.map((m) => ({
      id: `demo-${m.id}`,
      full: true,
      convId: m.conv,
      folder: m.folder,
      from: m.from,
      fromEmail: m.email,
      subject: pick(lang, m.subject),
      preview: pick(lang, m.body),
      receivedAt: m.when,
      unread: m.unread,
    })),
  );
  // Each message's key (what a todo cites as "mail:<key>").
  const keys = new Map<string, string>();
  for (const m of messages) {
    const r = getDb()
      .select({ key: schema.emails.key })
      .from(schema.emails)
      .where(sql`${schema.emails.convId} = ${m.conv} and ${schema.emails.receivedAt} = ${m.when}`)
      .get();
    if (r) keys.set(m.id, r.key);
  }
  const ref = (id: string) => (keys.has(id) ? [`mail:${keys.get(id)}`] : []);

  // People, with a date to remember.
  const people = await import("@/plugins/people/store");
  people.createPerson({ name: "Lena Hoffmann", emails: ["lena.hoffmann@example.com"], note: pick(lang, { de: "Kollegin, Präsentation am Donnerstag.", en: "Colleague, presentation on Thursday." }) });
  people.createPerson({ name: "Thomas Berger", emails: ["t.berger@example.com"], note: pick(lang, { de: "Vermieter.", en: "Landlord." }) });
  people.createPerson({ name: "Jonas", whatsapp: "Jonas", note: pick(lang, { de: "Alter Schulfreund.", en: "Old school friend." }) });
  const grandma = people.createPerson({ name: pick(lang, { de: "Oma Ilse", en: "Grandma Ilse" }) });
  const sunday = at(((7 - new Date().getDay()) % 7) || 7, 12);
  people.addDate(grandma, { kind: "birthday", day: sunday.getDate(), month: sunday.getMonth() + 1, year: 1942, yearly: true, remindDays: 3, confirmed: true });

  // The calendar: a few appointments this week.
  const { createCalendar, addEvent } = await import("@/lib/calendar/ir");
  const { plusMinutes } = await import("@/lib/calendar/ir-shared");
  const cal = createCalendar(pick(lang, { de: "Privat", en: "Personal" }), "emerald");
  const ev = (offset: number, hh: number, minutes: number, title: Text, location?: string) => {
    const start = localStamp(at(offset, hh));
    addEvent(cal.id, { title: pick(lang, title), start, end: plusMinutes(start, minutes), ...(location ? { location } : {}) });
  };
  ev(2, 10, 60, { de: "Präsentation mit Lena", en: "Presentation with Lena" }, pick(lang, { de: "Büro, Raum 3", en: "Office, room 3" }));
  ev(1, 18, 90, { de: "Yoga", en: "Yoga" });
  ev(((6 - new Date().getDay() + 7) % 7) || 7, 18, 180, { de: "Grillen bei Jonas", en: "Barbecue at Jonas'" });

  // The briefing that derived them (the Todos tab shows a run's todos): one done, with its lede.
  const runs = await import("@/lib/runs/store");
  const runId = runs.startRun("demo", null);
  runs.finishRun(runId, {
    status: "ok",
    tickets: [],
    durationMs: 42000,
    result: {
      lede: pick(lang, {
        de: "Fünf Dinge warten auf dich: zwei Antworten (Lena, Jonas), der Zählerstand für Herrn Berger bis Freitag, Omas Geburtstag am Sonntag und eine Rechnung über 84,20 €. Den Zahnarzttermin hast du schon bestätigt.",
        en: "Five things are waiting for you: two replies (Lena, Jonas), the meter reading for Mr Berger by Friday, Grandma's birthday on Sunday and an invoice of €84.20. You already confirmed the dentist.",
      }),
      tickets: [],
      left: [],
    },
  });

  // The todos Zeff derived from them — each with its sources, why, and a ready action.
  const now = new Date().toISOString();
  const add = (v: { text: Text; kind: string; source: string; refs: string[]; due?: string | null; ops?: unknown[]; why?: Text; note?: Text; status?: "open" | "done"; doneAt?: string }) =>
    getDb()
      .insert(schema.todos)
      .values({
        ticket: "",
        text: pick(lang, v.text),
        kind: v.kind,
        owner: "me",
        status: v.status ?? "open",
        source: v.source,
        runId,
        refs: JSON.stringify(v.refs),
        ops: JSON.stringify(v.ops ?? []),
        autoOpsWhy: v.why ? pick(lang, v.why) : null,
        actionsReviewedAt: v.ops?.length ? now : null,
        note: v.note ? pick(lang, v.note) : null,
        due: v.due ?? null,
        createdAt: now,
        updatedAt: now,
        doneAt: v.doneAt ?? null,
      })
      .run();

  add({
    text: { de: "Lena die drei Folien für Donnerstag schicken", en: "Send Lena the three slides for Thursday" },
    kind: "reply",
    source: "Mail-Durchsicht",
    refs: ref("lena"),
    due: day(1),
    why: { de: "Lena bittet bis Mittwochabend um die Folien.", en: "Lena asks for the slides by Wednesday evening." },
    ops: [
      {
        type: "gmail-compose",
        to: "lena.hoffmann@example.com",
        subject: pick(lang, { de: "Re: Folien für Donnerstag?", en: "Re: Slides for Thursday?" }),
        body: pick(lang, {
          de: "Hi Lena,\n\nklar — du bekommst die drei Folien morgen bis 18 Uhr.\n\nViele Grüße",
          en: "Hi Lena,\n\nsure — you'll have the three slides by 6 pm tomorrow.\n\nBest",
        }),
      },
    ],
  });
  add({
    text: { de: "Thomas Berger den Zählerstand des Wasserzählers schicken", en: "Send Thomas Berger the water meter reading" },
    kind: "reply",
    source: "Mail-Durchsicht",
    refs: ref("landlord"),
    due: day(((5 - new Date().getDay() + 7) % 7) || 7),
    why: { de: "Der Vermieter braucht ihn bis Freitag für die Nebenkostenabrechnung.", en: "The landlord needs it by Friday for the utilities statement." },
    ops: [
      {
        type: "calendar-entry",
        calendar: "",
        title: pick(lang, { de: "Wasserzähler ablesen und Foto an Herrn Berger", en: "Read the water meter, photo to Mr Berger" }),
        start: localStamp(at(1, 19)),
        minutes: 15,
        body: pick(lang, { de: "Für die Nebenkostenabrechnung, bis Freitag.", en: "For the utilities statement, by Friday." }),
      },
    ],
  });
  add({
    text: { de: "Jonas zusagen und einen Salat mitbringen", en: "Tell Jonas you're coming and bring a salad" },
    kind: "reply",
    source: "Nachrichten-Durchsicht",
    refs: ref("jonas"),
    why: { de: "Jonas fragt, ob du Samstag um 18 Uhr kommst und einen Salat mitbringst.", en: "Jonas asks whether you're coming on Saturday at 6 pm and bringing a salad." },
    ops: [{ type: "whatsapp-message", chat: "Jonas", body: pick(lang, { de: "Klar, ich bin dabei! Ich bring einen Kartoffelsalat mit 🥗", en: "Sure, count me in! I'll bring a potato salad 🥗" }) }],
  });
  add({
    text: { de: "Oma Ilse am Sonntag zum Geburtstag anrufen", en: "Call Grandma Ilse on Sunday for her birthday" },
    kind: "other",
    source: "Nachrichten-Durchsicht",
    refs: ref("mum"),
    due: localDay(sunday),
    why: { de: "Mama erinnert an Omas Geburtstag am Sonntag.", en: "Mum reminds you of Grandma's birthday on Sunday." },
    ops: [{ type: "whatsapp-message", chat: "Mama", body: pick(lang, { de: "Danke fürs Erinnern! Ich ruf sie Sonntag Vormittag an ❤️", en: "Thanks for the reminder! I'll call her on Sunday morning ❤️" }) }],
  });
  add({
    text: { de: "Hausratversicherung bezahlen: 84,20 € (Rechnung 2026-4471)", en: "Pay the home contents insurance: €84.20 (invoice 2026-4471)" },
    kind: "other",
    source: "Mail-Durchsicht",
    refs: ref("insurance"),
    due: day(6),
    why: { de: "Die Rechnung ist in sechs Tagen fällig.", en: "The invoice is due in six days." },
  });
  add({
    text: { de: "Den Kontrolltermin bei Dr. Weber bestätigen", en: "Confirm the check-up with Dr Weber" },
    kind: "reply",
    source: "Mail-Durchsicht",
    refs: ref("dentist"),
    status: "done",
    doneAt: iso(-1, 10),
    note: { de: "Erledigt: deine Antwort an die Praxis ist rausgegangen.", en: "Done: your reply to the practice went out." },
  });
  // Learn: a course on differential geometry a week in (src/plugins/learn/demo.ts).
  (await import("@/plugins/learn/demo")).seedLearnDemo(lang);
}

/** The demo account, if there is one. */
export const demoAccount = () => listAccounts().find((a) => a.demo);

/**
 * Into the demo: the account made (and filled) the first time, switched to after. The Accounts plugin is switched on for it
 * (its switcher is the way back). The id.
 */
export async function startDemo(): Promise<string> {
  const { switchAccount } = await import("@/lib/accounts");
  let a = demoAccount();
  if (!a) {
    if (!accountsInstalled()) setAccountsInstalled(true);
    a = addAccount("Demo", "amber", undefined, { demo: true });
    const lang: Lang = getLanguage() === "de" ? "de" : "en";
    const id = a.id;
    await withAccount(id, () => seedDemo(lang));
  }
  switchAccount(a.id);
  return a.id;
}

/** Out of the demo: back to the first account that isn't it. */
export async function leaveDemo(): Promise<string> {
  const { switchAccount } = await import("@/lib/accounts");
  const to = listAccounts().find((a) => !a.demo) ?? accountById(DEFAULT_ACCOUNT)!;
  switchAccount(to.id);
  return to.id;
}

/** Whether the demo's todos are there (a test's check). */
export const demoTodoCount = () => getDb().select({ n: sql<number>`count(*)` }).from(schema.todos).where(eq(schema.todos.status, "open")).get()?.n ?? 0;
