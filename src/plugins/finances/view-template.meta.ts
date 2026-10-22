import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { DEBTS_APP_DATA } from "./view-data";

/**
 * The debts overview as a template (the Workspace's view templates): built of the language's own tags — tabs, tiles, a table of the
 * debts, charts — and a few parts of the Finances plugin where it takes more (a figure changed in place, paying with a GiroCode, the
 * form for a new debt, the charts over the months). Client-safe.
 */

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const template = (t: T) => `<state name="dir" value="owe"/>
<state name="fixed" value="true"/>

<row gap=4 align=end>
  <tabs bind="dir" options="owe:${t("Creditors overview")}, owed:${t("Debtors overview")}"/>
  <printonly>
    <heading level=2>{{ app.owe ? ${q(t("Creditors overview"))} : ${q(t("Debtors overview"))} }}</heading>
    <muted>${t("As of {date}", { date: "{{ app.asOf }}" })}</muted>
  </printonly>
  <grow/>
  <button action="print" label="${t("Print / save as PDF")}"/>
</row>

{{#if app.loading}}
  <muted>{{ app.error | default('…') }}</muted>
{{#else}}

<grid cols=4 min=190>
  <tile label="{{ app.owe ? ${q(t("Open in all"))} : ${q(t("Owed to you in all"))} }}" value="{{ app.open | euro(0) }}" sub="${t("of {amount} in all", { amount: "{{ app.total | euro(0) }}" })}"/>
  {{#if app.fixedOn}}
    <tile label="${t("Running costs a month")}" value="{{ app.running | euro(0) }}" sub="${t("instalments {a} · fixed costs {b}", { a: "{{ app.rates | euro(0) }}", b: "{{ app.fixed | euro(0) }}" })}"/>
  {{#else}}
    <tile label="{{ app.owe ? ${q(t("Instalments a month"))} : ${q(t("Coming back a month"))} }}" value="{{ app.rates | euro(0) }}" sub="{{ app.ratesNote }}"/>
  {{/if}}
  <tile label="{{ app.owe ? ${q(t("Debt-free"))} : ${q(t("All back"))} }}" value="{{ app.debtFree | default('—') }}" sub="{{ app.debtFreeNote }}"/>
  {{#if app.owe}}
    <tile label="{{ app.fixedOn ? ${q(t("Left after instalments and fixed costs"))} : ${q(t("Left after the instalments"))} }}" value="{{ app.left | euro(0) | default('—') }}" tone="{{ app.leftTone }}">
      <part name="debts.income"/>{{#if app.fixedOn}} · ${t("fixed costs {amount}", { amount: "{{ app.fixed | euro(0) }}" })}{{/if}}
    </tile>
  {{#else}}
    <tile label="${t("Next payment")}" value="{{ app.nextAmount | euro | default('—') }}" sub="{{ app.nextDate }}" tone="{{ app.nextOverdue ? 'bad' : 'plain' }}"/>
  {{/if}}
</grid>

<part name="debts.add"/>

<datatable source="app.debts" empty="{{ app.owe ? ${q(t("No debts — or not written down yet (+ Debt)."))} : ${q(t("Nobody owes you anything — or it isn't written down yet (+ Debt)."))} }}">
  <column label="{{ app.owe ? ${q(t("Creditor"))} : ${q(t("Debtor"))} }}" foot="${t("Total")}">
    <row gap=2 wrap=false><dot color="{{ color }}"/><button action="open" row="{{ id }}" label="{{ creditor }}" variant=link/></row>
    <small><muted>{{ what }}</muted></small>
    {{#if contact}}<small><muted>{{ contact | truncate(70) }}</muted></small>{{/if}}
  </column>
  <column label="${t("Total")}" align=right foot="{{ app.total | euro }}">
    <text tone=muted><part name="debts.money" field="total" debt="{{ id }}"/></text>
  </column>
  <column label="${t("Open")}" align=right foot="{{ app.open | euro }}">
    <b><part name="debts.money" field="open" debt="{{ id }}"/></b>
    {{#if paid}}<bar value="{{ paid }}" max=1 fill="{{ color }}"/>{{/if}}
  </column>
  <column label="${t("Instalment")}" align=right foot="{{ app.ratesAll | euro }}">
    <part name="debts.money" field="installment" debt="{{ id }}"/>
  </column>
  <column label="${t("Next due")}">
    {{#if overdue}}<text tone=bad><part name="debts.money" field="due" debt="{{ id }}"/></text>{{#else}}<part name="debts.money" field="due" debt="{{ id }}"/>{{/if}}
    {{#if nextWhat}}<small><muted>{{ nextWhat | truncate(28) }}</muted></small>{{/if}}
  </column>
  <column label="${t("Plan")}" nowrap=true>
    {{#if noPlan}}<text tone=warn>{{ plan }}</text>{{#else}}{{ plan }}{{/if}}
    {{#if planUntil}}<small><muted>{{ planUntil }}</muted></small>{{/if}}
  </column>
  <column label="${t("Last payment")}" nowrap=true>
    {{#if lastDate}}{{ lastDate }} <small><muted>{{ lastAmount | euro }}</muted></small>{{#else}}<muted>—</muted>{{/if}}
  </column>
  <column label="" align=right>
    <row gap=1 justify=end wrap=false>
      {{#if canPay}}<part name="debts.pay" debt="{{ id }}"/>{{/if}}
      {{#if manual}}<part name="debts.delete" debt="{{ id }}"/>{{/if}}
    </row>
  </column>
</datatable>
{{#if app.estimated}}<small><muted>* ${t("No due day known: the plan is taken to start next month — set the due day for the exact date.")}</muted></small>{{/if}}

{{#if app.hasMonths}}
<grid cols="{{ app.chartCols }}" gap=4 min=260>
  <section title="{{ app.owe ? ${q(t("Open until debt-free"))} : ${q(t("Owed to you until all is back"))} }}">
    <box><part name="debts.balance-chart"/></box>
  </section>
  <section title="{{ app.owe ? ${q(t("Open by creditor"))} : ${q(t("Owed by debtor"))} }}">
    <box><chart kind=bar source="app.creditors" group="name" value="amount"/></box>
  </section>
  {{#if app.chartCols == 3}}
  <section title="${t("Fixed costs")} · {{ app.fixed | euro(0) }}">
    <box>
      <chart kind=bar source="app.fixedItems | sort('amount', 'desc')" group="name" value="amount"/>
      <small><muted>${t("From: {sources}", { sources: "{{ app.fixedSources }}" })}</muted></small>
    </box>
  </section>
  {{/if}}
</grid>

<section title="{{ app.owe ? ${q(t("Monthly payments until debt-free"))} : ${q(t("Coming back a month until all is back"))} }}">
  {{#if app.owe}}
    {{#if app.hasFixed}}
      <toggle bind="fixed" label="${t("Count in fixed costs ({amount})", { amount: "{{ app.fixedTotal | euro(0) }}" })}"/>
    {{#else}}
      <small><muted>${t("Fixed costs: publish a sum as “Fixkosten” under a column of a database of yours")}</muted></small>
    {{/if}}
  {{/if}}
  <box><part name="debts.monthly-chart"/></box>
</section>
{{/if}}

{{/if}}`;

export const DEBTS_VIEW: ViewAppMeta = {
  app: "debts",
  label: "Debts and claims",
  parts: [
    { name: "debts.add", description: "The form for a new debt (creditor, what for, amount, instalment, due) and the promises to write down as debts; the toolbar's New opens it" },
    { name: "debts.income", description: "Your income a month, changed with a click (from the bank statements, else yours)" },
    { name: "debts.money", description: "A debt's figure — changed in place for your own debts, as the letters say for a case's", attrs: { debt: "{{ id }} of an item of app.debts", field: "total | open | installment | due" } },
    { name: "debts.pay", description: "Pay: a button that shows the debt's GiroCode (IBAN, amount, purpose) to scan", attrs: { debt: "{{ id }}" } },
    { name: "debts.delete", description: "Remove one of your own debts (shown when the row is pointed at)", attrs: { debt: "{{ id }}" } },
    { name: "debts.balance-chart", description: "The money open month by month until debt-free (a line)" },
    { name: "debts.monthly-chart", description: "The payments a month until debt-free, stacked by creditor (and the fixed costs when counted in), the income as a line" },
  ],
  actions: [{ name: "debts.new", description: "open the form for a new debt" }],
  appData: DEBTS_APP_DATA,
  defaultTemplate: template,
};
