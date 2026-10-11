import { t } from "@/lib/i18n/server";
import { OWA_EXTRACTOR } from "./owa-extractor.mjs";

/** A text for the bookmarklet's alerts (in the account's language), as a JavaScript string literal. */
const js = (text: string) => JSON.stringify(text);

/** The browser-side extractor (see owa-extractor.mjs): reads the rendered week's events into `events`. */
const EXTRACTOR = OWA_EXTRACTOR;

/**
 * A `javascript:` bookmarklet that extracts events and opens Zeff with them.
 *
 * Outlook's Content-Security-Policy forbids the page from connecting to
 * localhost, so a direct POST is impossible. Instead the bookmarklet opens the
 * Zeff import page with the events in the URL fragment (which the page reads and
 * ingests same-origin). If the popup is blocked it copies them to the clipboard
 * for the paste box.
 */
export function buildBookmarklet(importUrl: string): string {
  const body = `(function(){try{${EXTRACTOR}
if(!events.length){alert(${js(t("Zeff: no calendar meetings found on this page. Open the Outlook calendar in Week view first."))});return;}
var payload=JSON.stringify({events:events});
var url=${JSON.stringify(importUrl)}+"#zeffimport="+encodeURIComponent(payload);
var w=window.open(url,"_blank");
if(!w){if(navigator.clipboard){navigator.clipboard.writeText(payload);}alert(${js(t("Zeff: your browser blocked the popup. Copied {n} meetings to the clipboard — paste them into Zeff → Import meetings."))}.replace("{n}",events.length));}
}catch(e){alert(${js(t("Zeff extractor error: {error}"))}.replace("{error}",e));}})();`;
  return "javascript:" + encodeURIComponent(body);
}

/** A variant that copies the events JSON to the clipboard for pasting into Zeff. */
export function buildCopyBookmarklet(): string {
  const body = `(function(){try{${EXTRACTOR}
if(!events.length){alert(${js(t("Zeff: no calendar meetings found. Open the Outlook Week view first."))});return;}
var json=JSON.stringify({events:events},null,2);
navigator.clipboard.writeText(json).then(function(){alert(${js(t("Zeff: copied {n} meetings. Paste them into Zeff → Import meetings."))}.replace("{n}",events.length));},function(){var w=window.open("","_blank");if(w){w.document.write("<pre>"+json.replace(/</g,"&lt;")+"</pre>");}});
}catch(e){alert(${js(t("Zeff extractor error: {error}"))}.replace("{error}",e));}})();`;
  return "javascript:" + encodeURIComponent(body);
}
