// The study times in the calendar: the weekly slots of every course kept as appointments for the next four weeks in a calendar of their own
// ("Learning"). Appointments that no slot wants any more go, the missing ones are made. Each carries a mark in its description.
// inputs: {}  ->  { added, removed, kept }   (needs Zeff's calendar API)
const COURSES = "@learn-ext.i2";
const CAL = "Learning";
const MARK = "learn-ext:";
const iso = (d) => d.toISOString().slice(0, 10);
const addMin = (stamp, m) => new Date(new Date(`${stamp}:00Z`).getTime() + m * 6e4).toISOString().slice(0, 16);
const db = await zeff.database(COURSES);
const c = (n) => db.cols.indexOf(n);
const today = new Date();
const days = Array.from({ length: 28 }, (_, i) => new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + i)));
const want = new Map();
for (const [i, row] of db.rows.entries()) {
  let slots = [];
  try { slots = JSON.parse(row[c("Slots")] || "[]") || []; } catch { slots = []; }
  for (const d of days) for (const s of slots) {
    if (((d.getUTCDay() + 6) % 7) !== s.day) continue;
    const start = `${iso(d)}T${s.time}`;
    want.set(`${MARK}${db.ids[i]}:${start}`, { title: `Lernen: ${row[0]}`, start, end: addMin(start, s.minutes || 30) });
  }
}
const have = (await zeff.api("calendar.events", { from: iso(days[0]), to: iso(days[days.length - 1]) })).filter((e) => String(e.description || "").startsWith(MARK));
let removed = 0, kept = 0, added = 0;
const seen = new Set();
for (const e of have) {
  const k = String(e.description).trim();
  if (want.has(k) && !seen.has(k)) { seen.add(k); kept++; }
  else { await zeff.api("calendar.event.delete", { id: e.id }); removed++; }
}
for (const [k, e] of want) if (!seen.has(k)) { await zeff.api("calendar.event.add", { title: e.title, start: e.start, end: e.end, description: k, calendarName: CAL }); added++; }
return { added, removed, kept };
