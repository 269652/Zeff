/**
 * The browser's half of an account's route (src/lib/account-routes.ts): a page under "/privat/…" keeps its prefix whatever the
 * code asks for — a root-relative fetch, an EventSource, the router's history entries get it — so the ~300 places that write
 * "/todos" or "/api/…" need not know. Runs inline in the root layout's <head>, before Next's own code (which then calls the
 * wrapped ones). What still slips through (a plain <a href="/…">, location.assign) is a page load the proxy sends on by its
 * Referer. Only on a prefixed page; the first account's (unprefixed) pages get nothing.
 */
export function accountNavScript(prefix: string): string {
  return `(function(){
var P=${JSON.stringify(prefix)};if(!P||window.__zeffPrefix)return;window.__zeffPrefix=P;
var O=location.origin;
function p(path){if(typeof path!=="string"||path.charAt(0)!=="/"||path.charAt(1)==="/"||path.charAt(1)==="\\\\")return path;
if(path===P||path.indexOf(P+"/")===0||path.indexOf(P+"?")===0||path.indexOf(P+"#")===0)return path;
if(/^\\/(_next|__nextjs)(\\/|$)/.test(path))return path;return P+path;}
function u(x){if(typeof x==="string"){if(x.charAt(0)==="/")return p(x);if(x.indexOf(O+"/")===0)return O+p(x.slice(O.length));return x;}
if(x instanceof URL&&x.origin===O){var y=new URL(x.href);y.pathname=p(y.pathname);return y;}return x;}
var f=window.fetch;window.fetch=function(i,o){if(typeof Request!=="undefined"&&i instanceof Request&&i.url.indexOf(O+"/")===0){var v=u(i.url);if(v!==i.url)i=new Request(v,i);}else i=u(i);return f.call(this,i,o);};
var E=window.EventSource;if(E){var W=function(url,o){return new E(u(url),o);};W.prototype=E.prototype;W.CONNECTING=0;W.OPEN=1;W.CLOSED=2;window.EventSource=W;}
["pushState","replaceState"].forEach(function(k){var h=history[k];history[k]=function(s,t,url){return h.call(this,s,t,url==null?url:u(url));};});
var a=window.open;window.open=function(url){var r=Array.prototype.slice.call(arguments);if(r.length)r[0]=u(url);return a.apply(this,r);};
function c(e){var el=e.target&&e.target.closest&&e.target.closest("a[href]");if(!el)return;
var h=el.getAttribute("href");var n=u(h);if(n!==h)el.setAttribute("href",n);}
document.addEventListener("click",c,true);document.addEventListener("auxclick",c,true);document.addEventListener("contextmenu",c,true);
})();`;
}
