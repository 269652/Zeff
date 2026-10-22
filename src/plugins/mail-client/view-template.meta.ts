import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import type { PartMeta } from "@/plugins/workspace/view-template";
import { CHAT_APP_DATA, INBOX_APP_DATA, MAIL_APP_DATA } from "./view-data";

/**
 * The mail client's views as templates (the Workspace's view templates): mail, chat, inbox — a list beside a reading pane, built of
 * the language's own tags (the list picks, the toggles and tabs filter, the pane's header and buttons in <selected>), and the
 * plugin's parts where it takes more (the conversation fetched, the reply, the suggestions, snooze). Client-safe.
 */

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
/** A date field written as the lists do: its time today, else its day. */
const when = (f: string) => `{{ ${f} ? formatDate(${f}, formatDate(${f}) == formatDate(today()) ? 'HH:mm' : 'DD.MM.') : '' }}`;
/** A channel's icon. */
const icon = (f: string, other: string) => `{{ ifs(${f} == 'Outlook', '✉️', ${f} == 'Gmail', '📮', ${f} == 'Teams', '🟣', ${f} == 'WhatsApp', '🟢', ${f} == 'Signal', '🔵', '${other}') }}`;

const NEW_INBOX: PartMeta = { name: "mail.new-inbox", description: "+ New inbox: one of the plugin's templates (Unread, From people, Important …) under this database", attrs: { type: "mail | message" } };
const TEXT: PartMeta = { name: "mail.text", description: "What a list item shows that isn't a property, on one line: the sender's name (bold with strong=\"true\"), a mail's preview, a thread's size (a badge when more than one)", attrs: { field: "from | preview | count", strong: "true: bold" } };
const THREAD: PartMeta = { name: "mail.thread", description: "The conversation of the one picked, oldest first (fetched; yours marked)" };
const SUGGESTED: PartMeta = { name: "mail.suggested", description: "The AI's suggested actions for the one picked (a reply, a follow-up)" };
const KNOW: PartMeta = { name: "mail.know", description: "What you should know about the one picked (the know plugin; nothing while it is off or there is nothing to say): its people — who they are, what is open with them —, what it is about, the latest, with the AI's points when kept" };
const REPLY: PartMeta = { name: "mail.reply", description: "The reply: a mail drafted to send yourself, a chat written (or drafted by the AI) and sent from here", attrs: { bar: "true: one line under a chat, Enter sends" } };

const mailTemplate = (t: T) => `<state name="selected" value="{{ app.first }}"/>
<split ratio=1:2>
<col>
  <row gap=2>
    <toggle bind="unread" label="${t("Unread only")}{{ app.unread ? ' (' + app.unread + ')' : '' }}"/>
    <grow/>
    <part name="mail.new-inbox" type="mail"/>
  </row>
  <list source="app.mails" select=true empty="${t("No mails here.")}">
    <row gap=2 align=baseline wrap=false>
      <part name="mail.text" field="from" strong="{{ mailunread ? 'true' : '' }}"/>
      <muted>${when("mailreceived")}</muted>
    </row>
    <clamp lines=1>{{#if mailunread}}<b>{{ title }}</b>{{#else}}{{ title }}{{/if}}</clamp>
    <clamp lines=1><muted><part name="mail.text" field="preview"/></muted></clamp>
  </list>
</col>
<col>
  <selected empty="${t("Pick a mail.")}">
    <heading level=2>{{ title }}</heading>
    <text tone=muted>{{ mailfrom }} · ${when("mailreceived")} · {{ mailaccount }} · {{ mailfolder }}</text>
    <row gap=1>
      {{#if app.current.link}}<button action="url" href="{{ app.current.link }}" label="↗ {{ app.current.gmail ? ${q(t("Open in Gmail"))} : ${q(t("Open in Outlook"))} }}"/>{{/if}}
      <button action="open" label="▤ ${t("Open as row")}"/>
      {{#if not app.current.canReply}}<muted>🔒 ${t("Read-only — reply in Outlook / Gmail")}</muted>{{/if}}
    </row>
    {{#if app.current.why}}<box tone=warn>⭐ {{ app.current.why }}</box>{{/if}}
    <part name="mail.know"/>
    <part name="mail.thread"/>
    <part name="mail.suggested"/>
    {{#if app.current.canReply}}<part name="mail.reply"/>{{/if}}
  </selected>
</col>
</split>`;

const chatTemplate = (t: T) => `<state name="selected" value="{{ app.first }}"/>
<split ratio=1:3>
<col>
  <row justify=end><part name="mail.new-inbox" type="message"/></row>
  <list source="app.chats" select=true empty="${t("No messages here.")}">
    <row gap=2 align=baseline>
      ${icon("msgchannel", "💬")}
      <b>{{ msgchat }}</b>
      <grow/>
      <muted>{{ msgsent ? formatDate(msgsent, 'DD.MM., HH:mm') : '' }}</muted>
    </row>
    <clamp lines=1><muted>{{#if msgmine}}${t("Me")}: {{/if}}{{ title }}</muted></clamp>
  </list>
</col>
<col>
  <selected empty="${t("Pick a chat.")}">
    <row gap=2>
      {{ app.current.icon }}
      <heading level=3>{{ app.current.name }}</heading>
      <grow/>
      {{#if app.current.link}}<button action="url" href="{{ app.current.link }}" label="↗ ${t("Open in {app}", { app: "{{ app.current.channel }}" })}"/>{{/if}}
    </row>
  </selected>
  {{#if app.current.id}}<part name="mail.know"/>{{/if}}
  <part name="chat.messages"/>
  {{#if app.current.id}}
    <part name="mail.suggested"/>
    {{#if app.current.canReply}}
      <part name="mail.reply" bar=true/>
    {{#else}}
      <muted>🔒 ${t("Read-only — replying through {channel} isn't set up here.", { channel: "{{ app.current.channel }}" })}</muted>
    {{/if}}
  {{/if}}
</col>
</split>`;

const inboxTemplate = (t: T) => `<state name="selected" value="{{ app.first }}"/>
<state name="channel" value=""/>
<split ratio=1:2>
<col>
  <row gap=1>
    <tabs bind="channel" options=":${t("All")} {{ app.total }}{{ app.allUnread }}, {{ app.channelOptions }}"/>
    <grow/>
    {{#if app.snoozedToggle}}<toggle bind="snoozed" label="💤 ${t("Snoozed conversations")} ({{ app.snoozed }})"/>{{/if}}
    <toggle bind="unread" label="${t("Unread only")}"/>
    <part name="mail.new-inbox" type="mail"/>
  </row>
  <list source="app.threads" select=true empty="${t("Nothing here.")}">
    <row gap=2 align=baseline wrap=false>
      ${icon("commchannel", "•")}
      <part name="mail.text" field="from" strong="{{ contains(app.unreadIds, id) ? 'true' : '' }}"/>
      <part name="mail.text" field="count"/>
      <muted>${when("commwhen")}</muted>
    </row>
    <clamp lines=1>{{#if contains(app.unreadIds, id)}}<b>{{ title }}</b>{{#else}}{{ title }}{{/if}}</clamp>
    <clamp lines=1><muted>{{ commwhere }}</muted></clamp>
  </list>
</col>
<col>
  <selected empty="${t("Pick a message.")}">
    <heading level=2>{{ title }}</heading>
    <text tone=muted>{{ app.current.icon }} {{ app.current.channel }} · {{ commfrom }} · ${when("commwhen")} · {{ commwhere }}</text>
    <row gap=1>
      {{#if app.current.link}}<button action="url" href="{{ app.current.link }}" label="↗ ${t("Open in {app}", { app: "{{ app.current.channel }}" })}"/>{{/if}}
      <button action="open" label="▤ ${t("Open as row")}"/>
      <part name="inbox.snooze"/>
      {{#if not app.current.canReply}}<muted>🔒 ${t("Read-only — replying through {channel} isn't set up here.", { channel: "{{ app.current.channel }}" })}</muted>{{/if}}
    </row>
    {{#if app.current.why}}<box tone=warn>⭐ {{ app.current.why }}</box>{{/if}}
    <part name="mail.know"/>
    <part name="mail.thread"/>
    <part name="mail.suggested"/>
    {{#if app.current.canReply}}<part name="mail.reply"/>{{/if}}
  </selected>
</col>
</split>`;

export const MAIL_VIEW: ViewAppMeta = {
  app: "mail",
  label: "Mail",
  parts: [NEW_INBOX, TEXT, KNOW, THREAD, SUGGESTED, REPLY],
  actions: [],
  appData: MAIL_APP_DATA,
  defaultTemplate: mailTemplate,
};
export const CHAT_VIEW: ViewAppMeta = {
  app: "chat",
  label: "Chat",
  parts: [NEW_INBOX, { name: "chat.messages", description: "The messages of the chat picked as bubbles (yours on the right), opened at the newest; a click opens one as a row" }, KNOW, SUGGESTED, REPLY],
  actions: [],
  appData: CHAT_APP_DATA,
  defaultTemplate: chatTemplate,
};
export const INBOX_VIEW: ViewAppMeta = {
  app: "inbox",
  label: "Inbox",
  parts: [NEW_INBOX, TEXT, { name: "inbox.snooze", description: "💤 Snooze: the thread picked away until later today, tomorrow morning, next week — or awake now" }, KNOW, THREAD, SUGGESTED, REPLY],
  actions: [],
  appData: INBOX_APP_DATA,
  defaultTemplate: inboxTemplate,
};
