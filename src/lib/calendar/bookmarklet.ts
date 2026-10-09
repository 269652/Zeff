import { OWA_EXTRACTOR } from "./owa-extractor.mjs";

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
if(!events.length){alert("Zeff: no calendar meetings found on this page. Open the Outlook calendar in Week view first.");return;}
var payload=JSON.stringify({events:events});
var url=${JSON.stringify(importUrl)}+"#zeffimport="+encodeURIComponent(payload);
var w=window.open(url,"_blank");
if(!w){if(navigator.clipboard){navigator.clipboard.writeText(payload);}alert("Zeff: your browser blocked the popup. Copied "+events.length+" meetings to the clipboard — paste them into Zeff → Import meetings.");}
}catch(e){alert("Zeff extractor error: "+e);}})();`;
  return "javascript:" + encodeURIComponent(body);
}

/** A variant that copies the events JSON to the clipboard for pasting into Zeff. */
export function buildCopyBookmarklet(): string {
  const body = `(function(){try{${EXTRACTOR}
if(!events.length){alert("Zeff: no calendar meetings found. Open the Outlook Week view first.");return;}
var json=JSON.stringify({events:events},null,2);
navigator.clipboard.writeText(json).then(function(){alert("Zeff: copied "+events.length+" meetings. Paste them into Zeff → Import meetings.");},function(){var w=window.open("","_blank");if(w){w.document.write("<pre>"+json.replace(/</g,"&lt;")+"</pre>");}});
}catch(e){alert("Zeff extractor error: "+e);}})();`;
  return "javascript:" + encodeURIComponent(body);
}
