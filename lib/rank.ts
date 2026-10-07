import type { Job, Prefs, Seniority, Stats } from "./types";
import { canonicalUrl, overlap, tokens } from "./util";

const LEVEL: Record<Exclude<Seniority, "any">, number> = { intern: 0, entry: 1, mid: 2, senior: 3 };

function freshnessPoints(h?: number): number {
  if (h === undefined) return 4;
  if (h <= 24) return 25;
  if (h <= 48) return 20;
  if (h <= 72) return 14;
  if (h <= 168) return 8;
  return 2;
}

function locationMatch(p: Prefs, j: Job): "match" | "remote" | "miss" | "unknown" {
  if (!p.location) return "match";
  const where = `${j.location ?? ""} ${j.snippet ?? ""}`;
  if (/^remote$/i.test(p.location.trim())) return j.remote || /remote/i.test(where) ? "match" : j.location ? "miss" : "unknown";
  if (!j.location && !j.snippet) return j.remote ? "remote" : "unknown";
  if (overlap(p.location, where) >= 0.5) return "match";
  if (j.remote || /remote/i.test(where)) return "remote";
  return j.location ? "miss" : "unknown";
}

/** Merge duplicates (same posting via different URLs, or same title+company), filter, then score. */
export function rankJobs(input: Job[], p: Prefs): { jobs: Job[]; stats: Omit<Stats, "candidates" | "fundedCompanies"> } {
  const stats = { duplicatesMerged: 0, closedRemoved: 0, visaFiltered: 0, seniorityFiltered: 0 };

  const byKey = new Map<string, Job>();
  for (const j of input) {
    const k1 = canonicalUrl(j.url);
    const k2 = `${j.company.toLowerCase().replace(/[^a-z0-9]/g, "")}|${tokens(j.title).join(" ")}`;
    const prev = byKey.get(k1) ?? byKey.get(k2);
    if (prev) {
      stats.duplicatesMerged++;
      // Keep the richer record; remember where else it appeared.
      if (j.verified === "live" && prev.verified !== "live") Object.assign(prev, { ...j, alsoOn: prev.alsoOn });
      if (j.source !== prev.source) prev.alsoOn = [...new Set([...(prev.alsoOn ?? []), j.source])];
      prev.funding ??= j.funding;
      prev.postedHoursAgo = Math.min(prev.postedHoursAgo ?? Infinity, j.postedHoursAgo ?? Infinity);
      if (!Number.isFinite(prev.postedHoursAgo)) prev.postedHoursAgo = undefined;
      continue;
    }
    byKey.set(k1, j);
    byKey.set(k2, j);
  }
  const unique = [...new Set(byKey.values())];

  const out: Job[] = [];
  for (const j of unique) {
    if (j.verified === "closed") { stats.closedRemoved++; continue; }
    if (p.needsVisa && j.visa === "no-sponsor") { stats.visaFiltered++; continue; }
    if (p.seniority !== "any" && j.seniority && j.seniority !== "any" && Math.abs(LEVEL[j.seniority] - LEVEL[p.seniority]) >= 2) { stats.seniorityFiltered++; continue; }

    const reasons: string[] = [];
    const roleFit = Math.max(...(p.roles.length ? p.roles : ["engineer"]).map((r) => overlap(r, j.title)));
    let score = roleFit * 35;
    if (roleFit >= 0.99) reasons.push("Exact role match");

    if (p.keywords.length) {
      const hay = `${j.title} ${j.snippet ?? ""}`;
      const hits = p.keywords.filter((k) => overlap(k, hay) >= 0.99);
      score += Math.min(10, hits.length * 5);
      if (hits.length) reasons.push(`Mentions ${hits.join(", ")}`);
    }

    const f = freshnessPoints(j.postedHoursAgo);
    score += f;
    if (j.postedHoursAgo !== undefined && j.postedHoursAgo <= 48) reasons.push("Posted in the last 48h");

    const loc = locationMatch(p, j);
    score += { match: 15, remote: 10, unknown: 5, miss: -10 }[loc];
    if (loc === "match" && p.location) reasons.push(`Matches ${p.location}`);
    if (loc === "remote" && p.location) reasons.push("Remote-friendly");

    if (p.seniority !== "any" && j.seniority === p.seniority) { score += 8; reasons.push(`${p.seniority} level`); }

    if (p.needsVisa && j.visa === "sponsors") { score += 10; reasons.push("Mentions visa sponsorship"); }
    if (j.funding) { score += 10; reasons.push(`Company just raised${j.funding.amount ? " " + j.funding.amount : ""}`); }
    if (j.verified === "live") { score += 5; reasons.push("Verified live at source"); }
    if (j.salary) score += 2;

    j.score = Math.round(Math.max(0, Math.min(100, score)));
    j.reasons = reasons;
    out.push(j);
  }
  out.sort((a, b) => b.score - a.score || (a.postedHoursAgo ?? 999) - (b.postedHoursAgo ?? 999));
  return { jobs: out, stats };
}
