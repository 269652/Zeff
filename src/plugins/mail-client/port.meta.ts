import type { T } from "@/lib/i18n/shared";

/**
 * Mail & Chat's views as the port's (zeff-plugins/plugins/mail-client-ext): the built-in's own templates — or ones you changed — with
 * what was code made of the view language alone. What a list and the pane read (app.*) the plugin's compute script works out in the
 * browser (<data name="app" compute="mail-client-ext.mail|chat|inbox"> — the built-in's view-data.ts, bundled: scripts/port-mail-client.mts);
 * each part is tags: the conversation a <data do="mail.thread">, the reply inputs and buttons that do the kernel's row.op, snooze a menu of
 * rows.set, archive mail.archive, the one looked at marked read by a <data do="mail.mark-read">. What you write is kept per mail (its own
 * state), as the built-in kept it per reply box. Client-safe.
 */

export const MAIL_PORT = { plugin: "mail-client-ext" } as const;
export type MailApp = "mail" | "chat" | "inbox";

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
/** A text in an attribute "…" (its quotes as the typographic ones: an attribute can't hold its own quote). */
const at = (s: string) => s.replace(/"/g, "”");

const C = "data.app.current";

/** A list item's text that isn't a property: the sender (bold when strong), the preview, a thread's size as a badge. */
function text(field: string, strong: string | undefined, t: T): string {
  const v = (k: string) => `{{ data.app.texts | get(id) | get('${k}') }}`;
  if (field === "count") return `{{#if data.app.texts | get(id) | get('countLabel')}}<badge tip="${at(t("{n} messages in this conversation", { n: "{{ data.app.texts | get(id) | get('count') }}" }))}">${v("countLabel")}</badge>{{/if}}`;
  if (field === "preview") return v("preview");
  const name = strong ? `{{#if ${strong}}}<b>${v("from")}</b>{{#else}}${v("from")}{{/if}}` : v("from");
  return `<col fill=true><truncate>${name}</truncate></col>`;
}

/** The conversation of the one picked, oldest first — fetched (its own, not the one picked before), else the message itself. */
// (a list of messages goes through {{#each}} as it is — a formula's ?: would make it text)
const thread = (t: T) => {
  const each = (list: string) => `{{#each ${list}}}<box tone="{{ mine ? 'accent' : 'plain' }}"><row gap=2><small><b>{{ mine ? ${q(t("Me"))} : name }}</b></small><small><muted>{{ at }}</muted></small></row><text pre=true>{{ preview }}</text></box>{{/each}}`;
  return `{{#if ${C}.fetch}}<data name="thread" do="mail.thread" with='{"conv": {{ ${C}.conv | tojson }}}'/>{{/if}}
<let name="mailLoaded" value="data.thread.conv == ${C}.conv"/>
<let name="mailN" value="data.thread.messages | count"/>
<col gap=2>
{{#if ${C}.fetch}}{{#if not mailLoaded}}<muted>…</muted>{{#else}}{{#if mailN}}${each("data.thread.messages")}{{#else}}${each(`${C}.fallbackList`)}{{/if}}{{/if}}{{#else}}${each(`${C}.fallbackList`)}{{/if}}
</col>`;
};

const know = () => `{{#if ${C}.id}}<know row="{{ ${C}.id }}" compact=true/>{{/if}}`;
const suggested = () => `{{#if ${C}.actions}}<suggested row="{{ ${C}.actions.rowId }}"/>{{/if}}`;

/** A mail's reply: written, or drafted by the AI; Outlook opens it as a draft, Gmail (its write access) sends or keeps it, a mailbox (IMAP) sends it. */
function mailReply(t: T): string {
  const k = `{{ ${C}.id }}`;
  // (a filter's argument is a name or a text: the state's name made first)
  const s = (v: string, name: string) => `<let name="${v}Key" value="'${name}' + ${C}.id"/><let name="${v}" value="state | get(${v}Key)"/>`;
  const op = (mode: string) => `with='{"row": ${k}, ${mode ? `"mode": "${mode}", ` : ""}"op": {"type": "{{ ${C}.reply.opType }}", "to": {{ mailTo | tojson }}, "subject": {{ mailSubject | tojson }}, "body": {{ mailBody | tojson }}}}'`;
  const off = `disabled="{{ mailBody and mailTo ? 'false' : 'true' }}"`;
  const close = `then="mailopen${k}=; mailbody${k}="`;
  const gmail = `${C}.reply.account == 'Gmail' and data.grants.gmailSend`;
  const draftAi = (label: string) => `<button do="row.reply.draft" with='{"row": ${k}}' fill="mailbody${k}=text, mailto${k}=to" then="mailopen${k}=1" label="${label}"/>`;
  const manage = `{{#if ${gmail}}}<button do="mail.gmail-change" with='{"row": ${k}, "what": "archive"}' label="${t("Archive")}" tip="${at(t("Out of the inbox — still in All Mail; nothing is deleted"))}"/><button do="mail.gmail-change" with='{"row": ${k}, "what": "unread"}' label="${t("Mark unread")}"/>{{/if}}`;
  return `{{#if ${C}.reply.kind == 'mail'}}
<state name="mailto${k}" value="{{ ${C}.reply.to }}"/>
<state name="mailsubject${k}" value="{{ ${C}.reply.subject }}"/>
${s("mailTo", "mailto")}
${s("mailSubject", "mailsubject")}
${s("mailBody", "mailbody")}
${s("mailOpen", "mailopen")}
<divider/>
{{#if not mailOpen}}
<row gap=2>
  <button action="state" state="mailopen${k}" value="1" label="↩ ${t("Reply")}"/>
  ${draftAi(`✨ ${t("Draft a reply with AI")}`)}
  ${manage}
</row>
{{#else}}
<input bind="mailto${k}" placeholder="${t("To")}" label=""/>
<input bind="mailsubject${k}" placeholder="${t("Subject")}"/>
<input bind="mailbody${k}" type=textarea rows=6 placeholder="${t("Your reply …")}"/>
<row gap=2 align=center>
  {{#if ${C}.reply.account == 'E-Mail'}}
    <button do="row.op" ${op("send")} confirm="${at(t("Send this mail to {to} now?", { to: "{{ mailTo }}" }))}" ${close} variant=primary ${off} label="${t("Send")}"/>
  {{#else}}{{#if ${gmail}}}
    <button do="row.op" ${op("send")} confirm="${at(t("Send this mail to {to} now?", { to: "{{ mailTo }}" }))}" ${close} variant=primary ${off} label="${t("Send")}"/>
    <button do="row.op" ${op("draft")} ${close} ${off} label="${t("Save as draft in Gmail")}"/>
    <button do="row.op" ${op("")} disabled="{{ mailBody ? 'false' : 'true' }}" label="↗ ${t("Open in {app}", { app: "Gmail" })}"/>
  {{#else}}
    <button do="row.op" ${op("")} variant=primary disabled="{{ mailBody ? 'false' : 'true' }}" label="↗ ${t("Open as a draft in {app}", { app: `{{ ${C}.reply.account }}` })}"/>
  {{/if}}{{/if}}
  ${draftAi(`✨ ${t("Draft with AI")}`)}
  <small><muted>{{ ${C}.reply.account == 'E-Mail' ? ${q(t("Sent from your mailbox, in this conversation."))} : ${gmail} ? ${q(t("Sent from your Gmail, in this conversation."))} : ${q(t("You send it there."))} }}</muted></small>
  <grow/>
  <button action="state" state="mailopen${k}" value="" variant=link label="${t("Cancel")}"/>
</row>
{{/if}}
{{/if}}`;
}

/** A chat's reply: written or drafted by the AI, sent through its channel on your click (asked first). `bar`: one line, Enter sends. */
function chatReply(t: T, bar: boolean): string {
  const k = `{{ ${C}.id }}`;
  const send = `do="row.op" with='{"row": {{ ${C}.reply.rowId }}, "op": {"type": "{{ ${C}.reply.op.type }}", "to": {{ ${C}.reply.chat | tojson }}, "chat": {{ ${C}.reply.chat | tojson }}, "body": {{ chatText | tojson }}}}' confirm="${at(t("Send to “{chat}” via {channel}?", { chat: `{{ ${C}.reply.chat }}`, channel: `{{ ${C}.reply.channel }}` }))}" done="${t("Sent.")}" then="chattext${k}="`;
  const buttons = `<button do="row.reply.draft" with='{"row": {{ ${C}.reply.rowId }}}' fill="chattext${k}=text" label="✨" tip="${t("Draft with AI")}"/>
  <button ${send} variant=primary disabled="{{ chatText ? 'false' : 'true' }}" label="${t("Send")}"/>`;
  return `{{#if ${C}.reply.kind == 'chat'}}
<let name="chatTextKey" value="'chattext' + ${C}.id"/><let name="chatText" value="state | get(chatTextKey)"/>
<divider/>
${bar ? `<on event="chat-send" ${send}/>\n` : ""}<row gap=2 align=${bar ? "center" : "start"}>
  <col fill=true><input bind="chattext${k}" type=textarea rows=${bar ? 1 : 2} placeholder="${t("Reply …")}"${bar ? ' enter="chat-send"' : ""}/></col>
  ${bar ? buttons : `<col gap=1>${buttons}</col>`}
</row>
{{/if}}`;
}

/** The chat picked as bubbles, yours on the right; a click opens one as a row. */
const messages = () => `<col gap=2 scroll=60 end=true>
{{#each ${C}.messages}}<row justify="{{ msgmine ? 'end' : 'start' }}"><col max="75%"><box tone="{{ msgmine ? 'accent' : 'muted' }}" action="open">{{#if not msgmine}}<small><muted>{{ msgsender }}</muted></small>{{/if}}<text pre=true>{{ title }}</text><row justify=end><small><muted>{{ msgsent ? formatDate(msgsent, 'DD.MM., HH:mm') : '' }}</muted></small></row></box></col></row>{{/each}}
</col>`;

/** 💤 Snooze: the whole thread away until a time — or awake again. */
function snooze(t: T): string {
  const ids = `{{ ${C}.ids | tojson }}`;
  // (snoozed: the notice offers Undo — awake again)
  const set = (value: string, label: string, done: string) => `<button do="rows.set" with='{"rows": ${ids}, "prop": "commsnooze", "value": ${value}}'${value === "null" ? "" : ` undo='{"rows": ${ids}, "prop": "commsnooze", "value": null}'`} done="${at(done)}" label="${label}"/>`;
  const opts: [string, string][] = [
    ["later", t("Later today")],
    ["tomorrow", t("Tomorrow morning")],
    ["week", t("Next week")],
  ];
  return `<menu label="💤 ${t("Snooze")}">
${opts.map(([k, label]) => set(`{{ data.app.snooze.${k} | tojson }}`, label, t("Snoozed — it comes back {when}.", { when: label.toLowerCase() }))).join("\n")}
${set("null", t("Wake up now"), t("Awake again."))}
</menu>`;
}

const archive = (t: T) => `<button do="mail.archive" with='{"rows": {{ ${C}.ids | tojson }}}' then="selected=" done="${t("Archived.")}" tip="${at(t("Out of the inbox — on the mail server too"))}" label="🗄 ${t("Archive")}"/>`;
const archiveRead = (t: T) => `{{#if data.app.imapAny}}<button do="mail.archive-read" confirm="${at(t("Archive every read conversation of your mailboxes' inboxes (IMAP / POP3)?"))}" variant=quiet label="${t("Archive read")}"/>{{/if}}`;

/** + New inbox: one of the plugin's templates under this database — or your own (its rules, the AI). */
const newInbox = (type: string, t: T) => `<data name="inboxtemplates" do="mail.inbox-templates" with='{"type": "${type === "message" ? "message" : "mail"}"}'/>
<menu label="＋ ${t("New inbox")}">
{{#each data.inboxtemplates.templates}}<button do="mail.new-inbox" with='{"parent": {{ db.id }}, "template": "{{ id }}"}' label="{{ icon }} {{ title }}" tip="{{ description }}"/>{{/each}}
<button do="mail.new-inbox" with='{"parent": {{ db.id }}, "template": "own"}' label="⚙ ${t("Your own (rules, AI) …")}"/>
</menu>`;

const attrsOf = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"|(\w+)=([^\s"/>]+)/g)].map((m) => [m[1] ?? m[3], m[2] ?? m[4]]));
/** strong="{{ X ? 'true' : '' }}" → X. */
const strongOf = (v: string | undefined) => v?.match(/^\{\{\s*(.+?)\s*\?\s*'true'\s*:\s*''\s*\}\}$/)?.[1];

/** The port's first conversation block (1.0.0: its messages lost their fields once fetched) — in a port's template already: the current one. */
const OLD_THREAD = /\{\{#if data\.app\.current\.fetch\}\}<data name="thread"[\s\S]*?<let name="mailMsgs"[\s\S]*?\{\{\/each\}\}\{\{\/if\}\}\s*<\/col>/;
export const upgradePortMail = (template: string, t: T): string => template.replace(OLD_THREAD, () => thread(t));

/** Which mail app a port's template is (by its compute function). */
export const portMailApp = (template: string | undefined): MailApp | null => (template?.match(new RegExp(`compute="${MAIL_PORT.plugin}\\.(mail|chat|inbox)"`))?.[1] as MailApp | undefined) ?? null;

/**
 * A built-in Mail & Chat view template — the plugin's own, or one you changed — as the port's: its app data from the plugin's compute
 * script, every <part> the view language's. A template already the port's stays as it is.
 */
export function toPortMail(template: string, app: MailApp, t: T): string {
  if (template.includes(`compute="${MAIL_PORT.plugin}.`)) return upgradePortMail(template, t);
  let s = template.replace(/(?<![\w.])app\./g, "data.app.");
  s = s.replace(/<part\s+name="([\w.-]+)"([^>]*?)\/>/g, (whole, name: string, rest: string) => {
    const a = attrsOf(rest);
    switch (name) {
      case "mail.text":
        return text(a.field ?? "from", strongOf(a.strong), t);
      case "mail.thread":
        return thread(t);
      case "mail.know":
        return know();
      case "mail.suggested":
        return suggested();
      case "mail.reply":
        // (at the bottom of the pane while the conversation above it scrolls)
        return `{{#if ${C}.reply}}<col dock=bottom>\n${mailReply(t)}\n${chatReply(t, a.bar === "true")}\n</col>{{/if}}`;
      case "chat.messages":
        return messages();
      case "inbox.snooze":
        return snooze(t);
      case "inbox.archive":
        return archive(t);
      case "inbox.archive-read":
        return archiveRead(t);
      case "mail.new-inbox":
        return newInbox(a.type ?? "mail", t);
      default:
        return whole;
    }
  });
  const head = [
    `<data name="app" compute="${MAIL_PORT.plugin}.${app}"/>`,
    `<data name="grants" do="zeff.grants"/>`,
    // The one picked, still unread, looked at for a moment (not the newest shown by itself): read — on its mail server too.
    `{{#if data.app.current.markIds | count}}<data name="markread" do="mail.mark-read" with='{"rows": {{ data.app.current.markIds | tojson }}}' debounce="1500" reload=true/>{{/if}}`,
  ];
  return `${head.join("\n")}\n${s}`;
}
