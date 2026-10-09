/**
 * The Outlook-web calendar extractor, as source code to run inside an Outlook tab
 * (outlook.office.com / outlook.cloud.microsoft) showing a week: it reads the events the
 * page has rendered — from their accessibility labels — into the Graph-shaped objects the
 * Zeff importer understands, in a variable `events`. It reads only calendar event labels:
 * no cookies, tokens or message content.
 *
 * Shared by the bookmarklet (bookmarklet.ts) and the Outlook driver (scripts/outlook-mcp.mjs),
 * so both produce the same ids ("owa:<date>T<HH:MM>:<title>") for already-booked matching.
 */
export const OWA_EXTRACTOR = String.raw`
var MONTHS={Januar:1,Februar:2,"März":3,"März":3,April:4,Mai:5,Juni:6,Juli:7,August:8,September:9,Oktober:10,November:11,Dezember:12,January:1,February:2,March:3,May:5,June:6,July:7,October:10,December:12};
function pad(n){return String(n).padStart(2,"0");}
function parseLabel(raw){
  var s=raw.trim(), cancelled=false;
  s=s.replace(/^(Sie folgen:\s*|Following:\s*)/i,"");
  while(/^(Abgesagt|Canceled|Cancelled):\s*/i.test(s)){cancelled=true;s=s.replace(/^(Abgesagt|Canceled|Cancelled):\s*/i,"");}
  var d=s.match(/(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})/);
  if(!d){return null;}
  var date=d[3]+"-"+pad(MONTHS[d[2]])+"-"+pad(+d[1]);
  var allDay=/ganztä|all day/i.test(s);
  var t=s.match(/(\d{1,2}):(\d{2})\s*(?:bis|to|–|-)\s*(\d{1,2}):(\d{2})/);
  var subject=s.split(/,\s*(?:\d{1,2}:\d{2}\s*(?:bis|to)|ganztä|all day)/i)[0].trim();
  var sa=(s.match(/,\s*(Free|Busy|Tentative|Frei|Gebucht|Mit Vorbehalt|Out of Office|Abwesend)\b/)||[])[1]||"";
  var org=(s.match(/,\s*(?:Von|From|Organizer:)\s+([^,]+?)\s*,/)||[])[1]||"";
  var teams=/Teams/i.test(s);
  var st=t?pad(+t[1])+":"+t[2]:"00:00", en=t?pad(+t[3])+":"+t[4]:"00:00";
  var id="owa:"+date+"T"+st+":"+subject.slice(0,50).replace(/\s+/g,"_");
  var saMap={Free:"free",Frei:"free","Out of Office":"oof",Abwesend:"oof",Busy:"busy",Gebucht:"busy",Tentative:"tentative","Mit Vorbehalt":"tentative"};
  return {id:id,iCalUId:id,subject:subject,
    start:{dateTime:date+"T"+st+":00.0000000",timeZone:"Europe/Berlin"},
    end:{dateTime:date+"T"+en+":00.0000000",timeZone:"Europe/Berlin"},
    isAllDay:allDay,isCancelled:cancelled,showAs:saMap[sa]||"busy",
    isOnlineMeeting:teams,onlineMeetingProvider:teams?"teamsForBusiness":"unknown",
    organizer:{emailAddress:{name:org}},location:{displayName:teams?"Microsoft Teams Meeting":""}};
}
var seen={}, events=[];
var labels=[].slice.call(document.querySelectorAll("[aria-label]"));
for(var i=0;i<labels.length;i++){
  var l=labels[i].getAttribute("aria-label");
  if(!l||l.length>400||!/(\d{1,2}:\d{2}\s*(?:bis|to)|ganztä|all day)/i.test(l))continue;
  if(/Arbeitsort|Working location/i.test(l))continue;
  var ev=parseLabel(l); if(!ev||/^\d{1,2}:\d{2}/.test(ev.subject))continue;
  if(seen[ev.id])continue; seen[ev.id]=1; events.push(ev);
}
`;
