/**
 * How the Entities plugin writes names so that one thing is found under every way of writing it: a mail domain cut to the part
 * an organisation registers ("mail.xing.com" → "xing.com"), an organisation's name without its legal form ("Acme GmbH" =
 * "ACME"), an address without its punctuation and abbreviations ("Hauptstr. 3, 10115 Berlin" = "Hauptstraße 3 10115
 * Berlin"). Pure functions, no database — client-safe.
 */

/**
 * Mail providers anyone gets an address at: an address there says nothing about where someone works. Matched on the
 * registrable domain, so "gmx.de" and "gmx.net" both count (every country's ending of the big ones).
 */
const FREEMAIL = new Set([
  "gmail", "googlemail", "gmx", "web", "outlook", "hotmail", "live", "msn", "icloud", "me", "mac", "yahoo", "ymail", "aol",
  "t-online", "freenet", "posteo", "mailbox", "proton", "protonmail", "pm", "tutanota", "tuta", "arcor", "online", "mail",
  "email", "gmx-topmail", "vodafone", "kabelmail", "1und1", "ionos", "yandex", "zoho", "fastmail", "hey", "orange", "libero",
  "laposte", "seznam", "wp", "o2", "o2online", "magenta", "unitybox", "versanet", "nexgo", "emailn",
]);
/** A provider's label is only freemail with a provider's ending ("web.de", not "web.dev"; "mail.de", not "mail.example"). */
const FREEMAIL_TLDS = /^(?:com|net|org|de|at|ch|fr|it|es|nl|be|co\.uk|uk|eu|me|io|ru|pl|cz|info|biz|ca|us)$/;

/** Endings registered one level deeper: "example.co.uk", "example.com.au". */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne", "go", "gv", "ltd", "plc"]);
/** Shared endings under a generic one ("sharepoint.eu.com" is SharePoint's, not "eu.com"'s). */
const SHARED_SUFFIXES = new Set(["eu.com", "us.com", "uk.com", "de.com", "br.com", "cn.com", "gr.com", "jpn.com", "ru.com", "sa.com", "za.com", "uk.net", "eu.org"]);

/** The part of a host an organisation registers: "mail.example.com" → "example.com", "shop.example.co.uk" → "example.co.uk". */
export function registrableDomain(host: string): string {
  const parts = host.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  const deeper = (tld.length === 2 && SECOND_LEVEL.has(second)) || SHARED_SUFFIXES.has(`${second}.${tld}`);
  return parts.slice(deeper ? -3 : -2).join(".");
}

/** The domain of an address ("" without one). */
export const domainOf = (email: string): string => {
  const at = email.lastIndexOf("@");
  return at > 0 ? registrableDomain(email.slice(at + 1)) : "";
};

/** Whether a domain is a mail provider's (gmail, gmx, web.de, outlook, icloud …) rather than an organisation's. */
export function isFreemail(domain: string): boolean {
  const reg = registrableDomain(domain);
  const dot = reg.indexOf(".");
  if (dot < 0) return false;
  return FREEMAIL.has(reg.slice(0, dot)) && FREEMAIL_TLDS.test(reg.slice(dot + 1));
}

/** A name for the organisation behind a domain: its label, each part capitalised ("example.com" → "Acme", "it-dienst.de" → "It-Dienst"). */
export function orgNameFromDomain(domain: string): string {
  const label = registrableDomain(domain).split(".")[0] ?? "";
  return label.replace(/(^|[-_])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase()).replace(/_/g, " ");
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

/** Legal forms and what goes with them — left out when names are compared. */
const LEGAL = /\b(?:gmbh|mbh|ag|se|kg|kgaa|ohg|gbr|ug|e\.?\s?v|e\.?\s?k|co|inc|ltd|llc|plc|corp|corporation|limited|sa|sas|sarl|bv|nv|ab|as|oy|spa|srl|holding|group|gruppe|haftungsbeschraenkt)\b\.?/g;

/** An organisation's name as compared: lower case, umlauts written out, without legal forms and punctuation ("Müller & Söhne GmbH & Co. KG" → "mueller & soehne"). */
export function normalizeOrgName(name: string): string {
  let v = fold(name)
    .replace(/\(.*?\)/g, " ")
    .replace(LEGAL, " ")
    .replace(/[.,;:"'’!?/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "… GmbH & Co. KG" leaves an "&" at the end.
  while (/^&|&$/.test(v)) v = v.replace(/^&\s*|\s*&$/g, "").trim();
  return v;
}

/** An address as compared: lower case, umlauts written out, "str." = "straße" = "strasse", without commas and double spaces. */
export function normalizeAddress(address: string): string {
  return fold(address)
    .replace(/str\.(?=\s|$|\d)/g, "strasse")
    .replace(/\bstr\b/g, "strasse")
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a text reads as a postal address (a street with its number, or a post code with a town). */
export const looksLikeAddress = (s: string): boolean => /\p{L}{3,}.*\s\d+\s?[a-zA-Z]?\b/u.test(s) || /\b\d{4,5}\s+\p{Lu}/u.test(s);

/** An appointment's place that is no place: a call (Teams, Zoom, Meet …) or a link. */
export const isOnlineLocation = (location: string): boolean => /https?:\/\/|\bteams\b|zoom|google meet|\bmeet\b|webex|skype|gotomeeting|jitsi|online|virtuell|virtual|telefon|phone|anruf|call\b/i.test(location);

/** A name or alias as the resolver compares it (people-style: lower case, umlauts written out, single spaces). */
export const foldName = (s: string): string => fold(s).replace(/[.,;:]+/g, " ").replace(/\s+/g, " ").trim();
