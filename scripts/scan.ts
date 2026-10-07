// CLI for testing the pipeline without the UI:
//   TINYFISH_API_KEY=... npm run scan -- --roles "software engineer" --location remote --deep
import { parsePrefs, scan } from "../lib/scan";
import type { ScanEvent } from "../lib/types";

const args = process.argv.slice(2);
const get = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const prefs = parsePrefs({
  roles: get("roles") ?? "software engineer",
  keywords: get("keywords") ?? "",
  location: get("location") ?? "",
  seniority: get("seniority") ?? "any",
  needsVisa: args.includes("--visa"),
  freshnessHours: Number(get("fresh") ?? 48),
  deep: args.includes("--deep"),
  lanes: { jobs: !args.includes("--no-jobs"), hackathons: !args.includes("--no-hackathons"), bounties: !args.includes("--no-bounties") },
});
console.log("prefs", prefs);

scan(prefs, (e: ScanEvent) => {
  if (e.type === "log") console.log(`  [${e.log.endpoint}${e.log.cached ? " cached" : ""}] ${e.log.label} — ${e.log.ok ? e.log.detail : "FAILED " + e.log.detail} (${e.log.ms}ms)`);
  else if (e.type === "status" || e.type === "error") console.log(`> ${e.type === "error" ? "ERROR " : ""}${e.message}`);
  else if (e.type === "jobs") {
    console.log(`\nJOBS (${e.items.length})${e.pending ? " [pending: " + e.pending + "]" : ""}`, e.stats);
    for (const j of e.items.slice(0, 15)) console.log(`  ${j.score} | ${j.title} — ${j.company} | ${j.location ?? "?"} | ${j.postedLabel ?? "?"} | ${j.verified} | visa:${j.visa}${j.funding ? " | 💰" + (j.funding.amount ?? "") : ""} | ${j.source}\n       ${j.url}\n       ${j.reasons.join(" · ")}`);
  } else if (e.type === "hackathons") {
    console.log(`\nHACKATHONS (${e.items.length})`);
    for (const h of e.items.slice(0, 10)) console.log(`  ${h.score} | ${h.title} | ${h.dates ?? "?"} | ${h.online ? "online" : "in person"} | ${h.prize ?? ""} | ${h.url}`);
  } else if (e.type === "bounties") {
    console.log(`\nBOUNTIES (${e.items.length})${e.pending ? " [pending]" : ""}`);
    for (const b of e.items.slice(0, 10)) console.log(`  ${b.score} | ${b.title} — ${b.poster} | ${b.reward} | ${b.url}`);
  } else if (e.type === "done") console.log(`\nDone in ${e.ms}ms`, e.calls);
});
