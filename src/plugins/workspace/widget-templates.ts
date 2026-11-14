import type { ActionMeta, PartMeta } from "./view-template";
import type { WidgetData } from "./widget-point";

/**
 * A plugin's widget drawn by the view language: the plugin gives the data (widget-point.ts), a template lays it out. Each kind of data
 * has its template as it comes (below — what the block shows until you change it); a block can keep one of its own (its `template`).
 * The data is app.* in the template — app.items, app.tiles, app.cards, app.value … as the plugin gave them. Where a piece is richer
 * than tags (a row with its tick and its actions on hover, a tile, a card the plugin's card template made), it is a part — and anything
 * of your own can stand in its place: the action `widget` (do="toggle" item="{{ id }}") does what the widget's own buttons do.
 */

export const WIDGET_PARTS: PartMeta[] = [
  { name: "item", description: "a row of app.items as the widget draws it: its tick, lead, text and detail, badge, meta and its actions on hover", attrs: { key: "{{ id }}" } },
  { name: "tile", description: "a figure of app.tiles as the widget draws it (its bar, its link)", attrs: { key: "{{ label }}" } },
  { name: "card", description: "a card of app.cards as the plugin's card template made it", attrs: { key: "{{ id }}" } },
  { name: "figure", description: "the one figure (app.value, app.caption, app.detail, app.href) as the widget draws it" },
  { name: "footer", description: "the widget's link at the bottom (app.footer.text → app.footer.href)" },
  { name: "empty", description: "what shows when there is nothing (app.empty)" },
];

export const WIDGET_ACTIONS: ActionMeta[] = [{ name: "widget", description: 'what the widget\'s own buttons do: do="toggle|<action id>" item="{{ id }}" (the row it acts on)' }];

export const WIDGET_APP_DATA =
  "app.kind (list | stats | cards | figure), app.has (there are items / cards), app.items [{ id, text, detail, icon, meta, href, badge, tone, done, wrap, actions: [{ id, label, icon }] }], app.title, app.count, app.empty, app.footer { text, href }, app.tiles [{ label, value, detail, tone, href, bar { value, max } }], app.cards [{ id, href }], app.value, app.caption, app.detail, app.href, app.hideTitle (the block's header is hidden)";

const TEMPLATES: Record<Exclude<WidgetData["kind"], "error">, string> = {
  list: [
    "{{! A list: its title, a row per item, the link below. }}",
    "{{#if app.title and not app.hideTitle}}<small><muted>{{ app.title }}</muted></small>{{/if}}",
    "{{#if app.has}}",
    "<col gap=0>",
    "{{#each app.items}}<part name=\"item\" key=\"{{ id }}\"/>{{/each}}",
    "</col>",
    "{{#else}}<part name=\"empty\"/>{{/if}}",
    "<part name=\"footer\"/>",
  ].join("\n"),
  stats: ["{{! Figures side by side, as many in a line as fit. }}", "<grid cols=4 gap=3 min=168>", "{{#each app.tiles}}<part name=\"tile\" key=\"{{ label }}\"/>{{/each}}", "</grid>"].join("\n"),
  cards: [
    "{{! Cards, as many in a line as fit; the link below. }}",
    "{{#if app.has}}",
    "<grid cols=3 gap=2 min=240>",
    "{{#each app.cards}}<part name=\"card\" key=\"{{ id }}\"/>{{/each}}",
    "</grid>",
    "{{#else}}<part name=\"empty\"/>{{/if}}",
    "<part name=\"footer\"/>",
  ].join("\n"),
  figure: ["{{! One figure, its caption under it. }}", "<part name=\"figure\"/>"].join("\n"),
};

/** The template a kind of widget data is drawn with as it comes. */
export const defaultWidgetTemplate = (kind: WidgetData["kind"]): string => (kind === "error" ? "" : TEMPLATES[kind]);
