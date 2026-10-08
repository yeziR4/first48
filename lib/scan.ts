import { findBounties } from "./sources/bounties";
import { findHackathons } from "./sources/hackathons";
import { findJobs } from "./sources/jobs";
import { TinyFish } from "./tinyfish";
import type { Emit, Prefs } from "./types";

/** Run every enabled lane in parallel, streaming results as each finishes. */
export async function scan(p: Prefs, emit: Emit): Promise<void> {
  const t = Date.now();
  const tf = new TinyFish(emit);
  const lanes: Promise<void>[] = [];
  const guard = (name: string, run: () => Promise<void>) =>
    lanes.push(run().catch((e) => emit({ type: "error", message: `${name}: ${(e as Error).message}` })));

  if (p.lanes.jobs) guard("Jobs", () => findJobs(tf, p, emit, (items, stats, pending) => emit({ type: "jobs", items, stats, pending })));
  if (p.lanes.hackathons) guard("Hackathons", async () => emit({ type: "hackathons", items: await findHackathons(tf, p, emit) }));
  if (p.lanes.bounties) guard("Bounties", () => findBounties(tf, p, emit, (items, pending) => emit({ type: "bounties", items, pending })));

  await Promise.all(lanes);
  emit({ type: "done", ms: Date.now() - t, calls: tf.calls });
}

export function parsePrefs(body: unknown): Prefs {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : String(v ?? "").split(","))
      .map((s) => String(s).trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, max);
  const lanes = (b.lanes ?? {}) as Record<string, unknown>;
  const fresh = Number(b.freshnessHours);
  return {
    roles: list(b.roles, 3),
    keywords: list(b.keywords, 6),
    location: String(b.location ?? "").trim().slice(0, 60),
    seniority: (["any", "intern", "entry", "mid", "senior"].includes(String(b.seniority)) ? b.seniority : "any") as Prefs["seniority"],
    needsVisa: Boolean(b.needsVisa),
    freshnessHours: ([24, 48, 168].includes(fresh) ? fresh : 48) as Prefs["freshnessHours"],
    lanes: { jobs: lanes.jobs !== false, hackathons: lanes.hackathons !== false, bounties: lanes.bounties !== false },
    deep: Boolean(b.deep),
    skills: list(b.skills, 30).map((x) => x.toLowerCase()),
  };
}
