import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { CASE_APP_DATA } from "./view-data";

/**
 * A case's own page as a template (the Workspace's view templates): who it is with and its status, where it stands and the money as
 * tiles, its todos, its mails and letters; beside them the payment, what the bank shows paid, the parties and your note — built of the
 * language's own tags. The status, the sources, the GiroCode, the contact pickers and the note are the plugin's parts. Client-safe.
 */

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** A party of the case: its role, its contact's page (as the AI read it or chosen by you), the field to choose it. */
const party = (t: T, role: string, label: string, hint: string) => `    <col gap=1>
      <row gap=2 align=baseline justify=between>
        <small tip="${hint}"><muted>${label}</muted></small>
        {{#if app.parties.${role}.name}}<button action="url" href="{{ app.parties.${role}.href }}" label="{{ app.parties.${role}.name }} →" variant=link tip="{{ app.parties.${role}.ai ? ${q(t("As the AI read it from the case"))} : ${q(t("Chosen by you"))} }}"/>{{/if}}
      </row>
      <part name="case.contact" role="${role}" label="${label}" hint="${hint}"/>
    </col>`;

const template = (t: T) => `{{#if app.loading}}
  <text tone=muted>{{ app.error | default('…') }}</text>
{{#else}}

<row gap=2 align=center>
  {{#if app.manual}}<badge>${t("Own debt")}</badge>{{#else}}<code>{{ app.label }}</code>{{/if}}
  {{#if app.creditor.name}}
    <badge><button action="url" href="{{ app.creditor.href }}" label="{{ app.creditor.name }}" variant=link tip="${t("Creditor")}"/></badge>
  {{#else}}
    {{#if app.person.name}}<badge><button action="url" href="{{ app.person.href }}" label="{{ app.person.name }}" variant=link/></badge>{{/if}}
  {{/if}}
  {{#if app.collector.name}}<muted>${t("via")}</muted> <button action="url" href="{{ app.collector.href }}" label="{{ app.collector.name }}" variant=link/>{{/if}}
  {{#if app.party}}<muted>{{ app.party }}</muted>{{/if}}
  <grow/>
  <part name="case.status"/>
  {{#if app.canCompile and not app.manual}}
    <button action="case.compile" label="{{ app.busy ? '…' : app.summed ? ${q(t("Sum up again"))} : ${q(t("Sum up"))} }}" disabled="{{ app.busy }}"/>
  {{/if}}
</row>

<split side=right width=340>
  <col gap=5>
    <section title="${t("Where it stands")}">
      {{#if app.summary}}
        <text>{{ app.summary }}</text>
      {{#else}}
        {{#if app.compiling}}
          <text tone=muted>${t("Being summed up from its mails, letters and todos …")}</text>
        {{#else}}
          <text tone=muted>{{ app.canCompile ? ${q(t("Not summed up yet — Sum up reads its mails, letters and todos."))} : ${q(t("With the LLM plugin the AI sums the case up."))} }}</text>
        {{/if}}
      {{/if}}
      {{#if app.summed and not app.manual}}
        <grid cols=4 gap=2 min=120>
          <tile label="${t("Total")}" value="{{ app.total | euro }}"/>
          <tile label="${t("Open")}" value="{{ app.open | euro }}"/>
          <tile label="${t("Instalment")}" value="{{ app.installment | euro }}"/>
          <tile label="${t("Next")}" value="{{ app.next }}"/>
        </grid>
      {{/if}}
    </section>

    <section title="${t("Todos")}">
      <list source="app.todos" spacing=compact empty="${t("No todo names this case.")}">
        <row gap=2 align=baseline wrap=false>
          <mono><button action="url" href="{{ href }}" label="{{ ref }}" variant=link/></mono>
          <col gap=0 fill=true>{{#if done}}<strike>{{ text }}</strike>{{#else}}<text>{{ text }}</text>{{/if}}</col>
          {{#if due}}<small><muted>{{ due }}</muted></small>{{/if}}
        </row>
      </list>
    </section>

    <section title="${t("Mails and letters")}" aside="${t("{m} mails · {d} letters", { m: "{{ app.mails }}", d: "{{ app.letters }}" })}">
      {{#if app.hasSources}}
        <part name="case.sources"/>
      {{#else}}
        <text tone=muted>${t("No mail or letter found for it yet.")}</text>
      {{/if}}
    </section>
  </col>

  <col gap=5>
    <section title="${t("Payment")}">
      {{#if app.payment}}
        <part name="case.pay"/>
      {{#else}}
        {{#if app.person.name}}
          <text tone=muted>${t("No account known for {name} yet — add the IBAN to their details.", { name: "{{ app.person.name }}" })}</text>
        {{#else}}
          <text tone=muted>${t("No account known for it yet — choose the person it is with.")}</text>
        {{/if}}
      {{/if}}
    </section>

    {{#if app.paid}}
      <section title="${t("Paid (bank)")}">
        <list source="app.paid" spacing=compact>
          <row gap=2 align=baseline justify=between><muted>{{ date }}</muted><b>{{ amount | euro }}</b></row>
        </list>
      </section>
    {{/if}}

    <section title="${t("Parties")}">
${party(t, "creditor", t("Creditor"), t("Who it is owed to"))}
${party(t, "collector", t("Collected by"), t("Bailiff, collection agency, lawyer"))}
${party(t, "payee", t("Paid to"), t("Whose account you pay to"))}
    </section>

    <section title="${t("Notes")}">
      <part name="case.note"/>
    </section>
  </col>
</split>

{{/if}}`;

export const CASE_PAGE: ViewAppMeta = {
  app: "case",
  label: "Case",
  parts: [
    { name: "case.status", description: "The case's status as a dropdown (open, closed, not a case) — saved at once" },
    { name: "case.sources", description: "Its mails, letters and appointments as cards (by kind, the newest first, more behind Show more)" },
    { name: "case.pay", description: "The payment: the amount to change (the instalment, else what is open, to start with) and its GiroCode with recipient, IBAN, BIC, amount and purpose to copy" },
    { name: "case.contact", description: "The field to choose a party's contact (or make a new one)", attrs: { role: "creditor | collector | payee", label: "its label", hint: "its placeholder" } },
    { name: "case.note", description: "Your note on the case — saved when you leave it" },
  ],
  actions: [{ name: "case.compile", description: "sum the case up (again) from its mails, letters and todos — the LLM plugin" }],
  appData: CASE_APP_DATA,
  defaultTemplate: template,
};
