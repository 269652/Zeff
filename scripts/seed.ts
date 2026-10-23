/**
 * Seed the job database with the known job numbers.
 * Safe to run repeatedly: job numbers that already exist are left untouched.
 *
 * Run with: npm run db:seed
 */
import { createJob, getJobByNumber } from "../src/lib/jobs";

const JOBS = [
  { number: "AB123-000001-00", name: "ACME Support" },
  { number: "AB123-000002-00", name: "ACME Relaunch" },
];

let created = 0;
for (const job of JOBS) {
  const existing = getJobByNumber(job.number);
  if (existing) {
    console.log(`= ${existing.number} — ${existing.name} (already exists)`);
    continue;
  }
  const row = createJob(job);
  console.log(`+ ${row.number} — ${row.name}`);
  created++;
}
console.log(`Done: ${created} job(s) created, ${JOBS.length - created} already present.`);
