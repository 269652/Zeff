// Study times into the calendar: an appointment in Zeff's own calendar, on one day or on several days in a row.
// inputs: { title, start: "2026-11-13T18:00", minutes?: 30, days?: 1 }   (needs the permission for Zeff's calendar.event.add)
const title = String(inputs.title || "Study").slice(0, 200);
const start = String(inputs.start || "");
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) throw new Error('start is a day and a time like "2026-11-13T18:00".');
const minutes = Math.max(5, Math.min(240, Number(inputs.minutes) || 30));
const days = Math.max(1, Math.min(30, Math.floor(Number(inputs.days) || 1)));
// (Wall-clock arithmetic: the text is read as if it were UTC and written back the same way, so no time zone creeps in.)
const shift = (iso, plusDays, plusMinutes) => new Date(new Date(`${iso}:00Z`).getTime() + plusDays * 864e5 + plusMinutes * 6e4).toISOString().slice(0, 16);
const made = [];
for (let d = 0; d < days; d++) {
  const s = shift(start, d, 0);
  const e = await zeff.api("calendar.event.add", { title, start: s, end: shift(s, 0, minutes) });
  made.push({ id: e.id, start: e.start });
}
return { count: made.length, events: made };
