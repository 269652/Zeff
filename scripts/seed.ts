/**
 * Seed a few example jobs (only if the jobs table is empty).
 * Run with: npm run db:seed
 */
import { listJobs, createJob } from "../src/lib/jobs";

const existing = listJobs({ includeInactive: true });
if (existing.length > 0) {
  console.log(`Skipping seed — ${existing.length} job(s) already exist.`);
} else {
  const samples = [
    { number: "2026-0001", name: "Internal / overhead", customer: "Internal", description: "Meetings, admin, tooling" },
    { number: "2026-0815", name: "Website relaunch", customer: "ACME GmbH" },
    { number: "PROJ-PROJ", name: "PROJ platform", customer: "PROJ", description: "Tickets from jira.example.com" },
  ];
  for (const s of samples) {
    const job = createJob(s);
    console.log(`Created job ${job.number} — ${job.name}`);
  }
}
