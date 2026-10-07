// Bounties lane: companies posting paid tasks on task marketplaces (e.g. Pond).
// Fetch reads the public task list; Search resolves direct task links for free;
// Agent (deep mode) clicks through cards whose links only exist in the browser.
import { agentJson, type TinyFish } from "../tinyfish";
import type { Bounty, Emit, Prefs } from "../types";
import { hash, money, overlap, tokens } from "../util";

interface RawTask { title: string; poster?: string; reward?: string; solvers?: number; spotsLeft?: number; expired: boolean }

interface BountySource {
  name: string;
  listUrl: string;
  domain: string;
  detailPattern: RegExp;
  parse: (html: string) => RawTask[];
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim();

function parsePond(html: string): RawTask[] {
  const out: RawTask[] = [];
  for (const m of html.matchAll(/<article>([\s\S]*?)<\/article>/g)) {
    const a = m[1];
    const title = a.match(/<h2>([\s\S]*?)<\/h2>/)?.[1];
    if (!title) continue;
    const ps = [...a.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => decode(x[1]));
    const afterTitle = a.split("</h2>")[1] ?? "";
    const poster = afterTitle.match(/<p>([\s\S]*?)<\/p>/)?.[1];
    const rewardIdx = ps.findIndex((p) => /total rewards/i.test(p));
    out.push({
      title: decode(title),
      poster: poster ? decode(poster) : undefined,
      reward: rewardIdx >= 0 ? ps[rewardIdx + 1] : undefined,
      solvers: Number(ps.find((p) => /solvers? joined/i.test(p))?.match(/\d+/)?.[0] ?? NaN) || undefined,
      spotsLeft: Number(ps.find((p) => /rewards? left/i.test(p))?.match(/\d+/)?.[0] ?? NaN) || undefined,
      expired: ps.some((p) => /^expired$/i.test(p)),
    });
  }
  return out;
}

// Add more marketplaces here (TaskOn, etc.) once their public list pages are confirmed.
export const BOUNTY_SOURCES: BountySource[] = [
  { name: "Pond", listUrl: "https://joinpond.ai/tasks", domain: "joinpond.ai", detailPattern: /joinpond\.ai\/tasks\/detail\//, parse: parsePond },
];

function score(t: RawTask, interest: string): { score: number; reasons: string[] } {
  const usd = money(t.reward);
  const reasons: string[] = [];
  let score = 30;
  const fit = interest ? overlap(t.title, interest) + overlap(interest, t.title) : 0;
  if (fit > 0.2) { score += Math.min(30, fit * 30); reasons.push("Related to your interests"); }
  if (usd) { score += Math.min(25, Math.log10(usd + 1) * 8); reasons.push(`${t.reward} reward`); }
  if (t.spotsLeft) { score += 5; reasons.push(`${t.spotsLeft} reward${t.spotsLeft > 1 ? "s" : ""} left`); }
  if (t.solvers !== undefined && t.solvers < 20) { score += 5; reasons.push("Low competition"); }
  if (/\b(build|code|develop|api|agent|bot|tool|bug|test)/i.test(t.title) && tokens(interest).length) score += 5;
  return { score: Math.round(Math.min(100, score)), reasons };
}

export async function findBounties(tf: TinyFish, p: Prefs, emit: Emit, publish: (items: Bounty[], pending?: string) => void): Promise<void> {
  emit({ type: "status", message: "Reading company bounty boards…" });
  const pages = await tf.fetch(BOUNTY_SOURCES.map((s) => s.listUrl), "Read bounty boards", { format: "html", purpose: "List open paid tasks and bounties with their rewards" });
  const interest = [...p.roles, ...p.keywords].join(" ");

  const boards = await Promise.all(BOUNTY_SOURCES.map(async (src) => {
    const open = src.parse(pages.get(src.listUrl)?.text ?? "").filter((t) => !t.expired);
    const links = new Map<string, string>();
    if (open.length) {
      // Resolve direct task links with Search first (free).
      const found = await tf.search({ query: `${src.name} task bounty`, include_domains: src.domain }, `${src.name}: resolve task links`).catch(() => []);
      for (const r of found) {
        if (!src.detailPattern.test(r.url)) continue;
        const t = open.find((o) => overlap(o.title, r.title) >= 0.7);
        if (t) links.set(t.title, r.url);
      }
    }
    return { src, open, links };
  }));

  const build = () => boards.flatMap(({ src, open, links }) => open.map((t): Bounty => ({
    id: hash(src.name + t.title), title: t.title, url: links.get(t.title) ?? src.listUrl, source: src.name,
    poster: t.poster, reward: t.reward, rewardUsd: money(t.reward), solvers: t.solvers, spotsLeft: t.spotsLeft,
    ...score(t, interest),
  }))).sort((a, b) => b.score - a.score);

  const missing = p.deep ? boards.filter((b) => b.links.size < b.open.length) : [];
  publish(build(), missing.length ? "Agent is opening task cards to get direct links…" : undefined);
  if (!missing.length) return;

  // Agent: the cards' links only exist in the browser, so click through them.
  await Promise.all(missing.map(async ({ src, open, links }) => {
    const raw = await tf.agent(src.listUrl,
      `This page lists tasks/bounties as cards. For every card that is NOT marked "Expired", open it and note its URL, then go back. ` +
      `Return ONLY a JSON array of {"title","url"}.`, `Agent: open ${src.name} task cards for direct links`, { maxSeconds: 120 });
    for (const x of agentJson<{ title: string; url: string }[]>(raw) ?? []) {
      const t = open.find((o) => overlap(o.title, x.title ?? "") >= 0.7);
      if (t && x.url && src.detailPattern.test(x.url)) links.set(t.title, x.url);
    }
  }));
  publish(build());
}
