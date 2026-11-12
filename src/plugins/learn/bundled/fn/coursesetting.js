// A course's own settings: how much a path interests the person (0 not now … 3 most of all - it orders the next steps and the thread), the daily goal
// (20 / 50 / 100 / 200 XP), the study times (weekly slots: weekday 0-6 from Monday, HH:MM, 15-120 minutes - up to 21), the space (a group of courses).
// inputs: { course, interest?: path, level?: 0..3, dailyGoal?, slotAdd?: { day, time, minutes }, slotRemove?: index, space? }
const COURSES = "@learn-ext.i2";
const db = await zeff.database(COURSES);
const c = (n) => db.cols.indexOf(n);
const want = String(inputs.course).split(",")[0].trim().replace(/^#/, "").toLowerCase();
const at = db.rows.findIndex((r, i) => String(db.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no course "${inputs.course}".`);
const row = db.rows[at];
const patch = {};
const parse = (name, fallback) => { try { const v = JSON.parse(row[c(name)] || ""); return v ?? fallback; } catch { return fallback; } };
if (inputs.interest !== undefined) {
  const interests = parse("Interests", {});
  interests[String(inputs.interest)] = Math.max(0, Math.min(3, Math.round(Number(inputs.level) || 0)));
  patch.Interests = JSON.stringify(interests);
}
if (inputs.dailyGoal !== undefined) patch.DailyGoal = [20, 50, 100, 200].includes(Number(inputs.dailyGoal)) ? Number(inputs.dailyGoal) : Math.max(5, Math.min(1000, Math.round(Number(inputs.dailyGoal) || 50)));
let slots = null;
if (inputs.slotAdd || inputs.slotTime) {
  slots = parse("Slots", []);
  const s = inputs.slotAdd || { day: inputs.slotDay, time: inputs.slotTime, minutes: inputs.slotMinutes };
  const day = Math.floor(Number(s.day));
  if (!(day >= 0 && day <= 6) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time))) throw new Error("A study time is a weekday (0 = Monday … 6 = Sunday) and a time like 18:30.");
  if (slots.length >= 21) throw new Error("At most 21 study times.");
  slots.push({ day, time: String(s.time), minutes: Math.max(15, Math.min(120, Math.round(Number(s.minutes) || 30))) });
}
if (inputs.slotRemove !== undefined) {
  slots = slots || parse("Slots", []);
  slots = slots.filter((_, i) => i !== Number(inputs.slotRemove));
}
if (slots) patch.Slots = JSON.stringify(slots);
if (inputs.space !== undefined) patch.Space = String(inputs.space).slice(0, 60);
if (Object.keys(patch).length) await zeff.updateRow(COURSES, db.ids[at], patch);
if (slots) await zeff.call("learn-ext", "studytimes", {});
return { course: String(row[0]), changed: Object.keys(patch) };
