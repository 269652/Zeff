import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { CASES_APP_DATA } from "./view-data";

/**
 * The cases overview as a template (the Workspace's view templates): the figures as tiles, the running cases as a list — who it is
 * owed to, the next step, Pay — built of the language's own tags; the bank bar and a case's GiroCode are the plugin's parts.
 * Client-safe.
 */

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const template = (t: T) => `<state name="paying" value=""/>

{{#if app.loading}}
  <text tone=muted>{{ app.error | default('…') }}</text>
{{#else}}

<row gap=3 align=start justify=between>
  <part name="cases.bank"/>
  {{#if app.debtsUrl}}<button action="url" href="{{ app.debtsUrl }}" label="${t("Creditors overview")} →"/>{{/if}}
</row>

<grid cols=4 gap=3 min=150>
  <tile label="${t("Open in all")}" value="{{ app.open | euro }}"/>
  <tile label="${t("Due in 30 days")}" value="{{ app.dueSoon | euro }}"/>
  <tile label="${t("Running cases")}" value="{{ app.running }}"/>
  <tile label="${t("Overdue")}" value="{{ app.overdue }}" tone="{{ app.overdue > 0 ? 'bad' : 'plain' }}"/>
</grid>

<list source="app.cases" spacing=roomy grid="max-content minmax(0,80ch) 1fr max-content" empty="${t("No case running.")}">
  <row gap=2>
    <col align=end><mono>{{ label }}</mono></col>
    <col gap=1>
      <row>{{#if rowId}}<button action="open" row="{{ rowId }}" label="{{ name }}" variant=link print=true/>{{#else}}<b>{{ name }}</b>{{/if}}</row>
      {{#if sub}}<row><muted>{{ sub }}</muted></row>{{/if}}
      <row gap=3 align=baseline>
        {{#if hasDue}}
          {{#if overdue}}
            <text tone=bad>${t("Overdue since {date}", { date: "{{ due }}" })}{{#if nextWhat}} · {{ nextWhat }}{{/if}}</text>
          {{#else}}
            <text>{{ due }}{{#if nextWhat}} · {{ nextWhat }}{{/if}}</text>
          {{/if}}
        {{#else}}
          <text tone=muted>{{ summed ? ${q(t("Nothing due."))} : ${q(t("Not summed up yet"))} }}</text>
        {{/if}}
      </row>
      {{#if paying}}<part name="cases.girocode" case="{{ id }}"/>{{/if}}
    </col>
    <grow/>
    <col gap=2 align=end>
      <row><b tip="${t("From the case's letters and mails")}">{{ open | euro | default('—') }}</b></row>
      <row>
        {{#if paying}}
          <button action="state" state="paying" value="" label="${t("Close")}"/>
        {{#else}}
          {{#if payment}}
            <button action="state" state="paying" value="{{ id }}" label="${t("Pay with GiroCode")}" variant=primary/>
          {{#else}}
            <small><muted>${t("No account known")}</muted></small>
          {{/if}}
        {{/if}}
      </row>
    </col>
  </row>
</list>

{{/if}}`;

export const CASES_VIEW: ViewAppMeta = {
  app: "cases",
  label: "Cases",
  parts: [
    { name: "cases.bank", description: "The bank bar: a statement read from a file, the bank connection (signing in, syncing); the overview read again after" },
    { name: "cases.girocode", description: "A case's GiroCode (IBAN, amount, purpose) to scan and pay", attrs: { case: "{{ id }} of an item of app.cases" } },
  ],
  actions: [],
  appData: CASES_APP_DATA,
  defaultTemplate: template,
};
