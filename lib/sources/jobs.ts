// Jobs lane.
//  1. Search: fresh postings straight from company applicant-tracking systems (ATS),
//     filtered by recency, so we skip aggregator reposts entirely.
//  2. Search (news): companies that announced funding in the last few days, then
//     Search again to find which ATS each one uses -> Fetch their board.
//  3. Fetch: read every candidate posting at the source to confirm it is still live
//     and pull location, salary, seniority and visa wording.
//  4. Agent (deep mode only): careers pages Fetch can't read (JS-rendered boards and
//     custom careers sites of freshly funded companies).
import { agentJson, type SearchResult, type TinyFish } from "../tinyfish";
import type { Emit, Job, Prefs, Stats } from "../types";
import { ageLabel, canonicalUrl, CLOSED, detectSalary, detectSeniority, detectVisa, hash, hoursAgo, overlap, titleCase } from "../util";
import { rankJobs } from "../rank";
import { findSkills } from "../profile";

interface Ats {
  name: string;
  domains: string;
  isJob: RegExp;
  board: (u: URL) => string | undefined;
  company: (u: URL) => string;
  fetchable: boolean; // false when the board renders client-side (needs Agent)
}

const seg = (u: URL, i = 0) => u.pathname.split("/").filter(Boolean)[i] ?? "";

export const ATS: Ats[] = [
  {
    name: "Ashby", domains: "jobs.ashbyhq.com", fetchable: true,
    isJob: /jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}/i,
    board: (u) => `https://jobs.ashbyhq.com/${seg(u)}`, company: (u) => seg(u),
  },
  {
    name: "Greenhouse", domains: "job-boards.greenhouse.io,boards.greenhouse.io", fetchable: true,
    isJob: /greenhouse\.io\/[^/]+\/jobs\/\d+/i,
    board: (u) => `https://job-boards.greenhouse.io/${seg(u)}`, company: (u) => seg(u),
  },
  {
    name: "Lever", domains: "jobs.lever.co", fetchable: true,
    isJob: /jobs\.lever\.co\/[^/]+\/[0-9a-f-]{36}/i,
    board: (u) => `https://jobs.lever.co/${seg(u)}`, company: (u) => seg(u),
  },
  {
    name: "Workday", domains: "myworkdayjobs.com", fetchable: true,
    isJob: /myworkdayjobs\.com\/.*\/job\//i,
    board: () => undefined, company: (u) => u.hostname.split(".")[0],
  },
  {
    name: "Workable", domains: "apply.workable.com", fetchable: false,
    isJob: /apply\.workable\.com\/[^/]+\/j\/[A-Z0-9]+/i,
    board: (u) => `https://apply.workable.com/${seg(u)}/`, company: (u) => seg(u),
  },
  {
    name: "YC Work at a Startup", domains: "ycombinator.com", fetchable: true,
    isJob: /ycombinator\.com\/companies\/[^/]+\/jobs\/[^/]+/i,
    board: (u) => `https://www.ycombinator.com/companies/${seg(u, 1)}/jobs`, company: (u) => seg(u, 1),
  },
];

const ALL_ATS_DOMAINS = ATS.map((a) => a.domains).join(",");

function atsFor(url: string): { ats: Ats; u: URL } | undefined {
  try {
    const u = new URL(url);
    const ats = ATS.find((a) => a.isJob.test(url) || a.domains.split(",").some((d) => u.hostname.endsWith(d)));
    return ats ? { ats, u } : undefined;
  } catch {
    return undefined;
  }
}

/** Search titles look like "Title @ Co", "Job Application for Title at Co", "Co - Title", "Title - Myworkdayjobs.com". */
function cleanTitle(raw: string, company: string): string {
  let t = raw
    .replace(/^job application for\s+/i, "")
    .replace(/\s*[-|–]\s*myworkdayjobs\.com.*$/i, "")
    .replace(/\s*[|]\s*Y Combinator.*$/i, "")
    .replace(/\s+@\s+.+$/, "")
    .replace(/\s+at\s+[A-Z][\w .&-]+$/, "")
    .replace(/\s*\.\.\.$/, "")
    .trim();
  const co = company.toLowerCase();
  const dash = t.split(/\s+[-–]\s+/);
  if (dash.length > 1 && dash[0].toLowerCase().replace(/\s/g, "").includes(co.replace(/[-\s]/g, ""))) t = dash.slice(1).join(" - ");
  return t;
}

function companyName(raw: string, slug: string): string {
  const at = raw.match(/\s@\s(.+)$/) ?? raw.match(/\sat\s([A-Z][\w .&-]+)$/);
  return at ? at[1].trim() : titleCase(slug);
}

function fromSearch(r: SearchResult): Job | undefined {
  const hit = atsFor(r.url);
  if (!hit || !hit.ats.isJob.test(r.url)) return undefined;
  const slug = hit.ats.company(hit.u);
  const company = companyName(r.title, slug);
  const h = hoursAgo(r.date);
  const loc = r.snippet?.match(/Location[.:]\s*([^;|\n.]+)/i)?.[1]?.trim();
  return {
    id: hash(canonicalUrl(r.url)),
    title: cleanTitle(r.title, company),
    company,
    slug,
    url: r.url.split("?")[0],
    source: hit.ats.name,
    location: loc,
    snippet: r.snippet,
    postedHoursAgo: h,
    postedLabel: ageLabel(h),
    visa: "unknown",
    verified: "unverified",
    score: 0,
    reasons: [],
  };
}

function queryFor(role: string, p: Prefs): string {
  const bits = [role];
  if (p.seniority === "intern") bits.push("intern");
  if (p.seniority === "entry") bits.push("new grad OR junior OR entry level");
  if (p.location && !/^remote$/i.test(p.location)) bits.push(p.location);
  if (/remote/i.test(p.location)) bits.push("remote");
  return bits.join(" ");
}

// ---------- funding signal ----------

interface Funded { name: string; amount?: string; headline: string; url: string; hoursAgo?: number }

const DESCRIPTOR = /^(exclusive:?|startup|start-up|ai|fintech|healthtech|edtech|med-?tech|medtech|biotech|insurtech|proptech|climate|defense|defence|saas|platform|company|firm|unicorn|stealth|robotics|crypto|web3|cybersecurity|security|developer|dev|tools?|agentic|maker|provider|tech)$/i;

export function companyFromHeadline(t: string): Funded | undefined {
  const m = t.match(/^(.*?)\s+(raises|raised|secures|lands|closes|bags|nabs|snags|banks|gets|picks up|scores)\s+(?:a\s+)?(?:[$€£₹]|rs\.?\s|inr|\d|seed|series|pre-seed|funding|new)/i);
  if (!m) return undefined;
  let words = m[1].split(",")[0].trim().split(/\s+/);
  const lastDesc = words.map((w) => DESCRIPTOR.test(w)).lastIndexOf(true);
  if (lastDesc >= 0) words = words.slice(lastDesc + 1);
  if (!words.length || words.length > 4) return undefined;
  if (!words.every((w) => /^[A-Z0-9]/.test(w))) return undefined;
  const name = words.join(" ").replace(/['’]s$/, "");
  if (name.length < 2 || /^(at|in|how|why|what|the|this|after|with|from|as|by|when|who|report|watch|exclusive)$/i.test(words[0]) || /^\d|-based$|^[A-Z]$/i.test(name) || /-based/i.test(name)) return undefined;
  const amount = t.match(/(?:[$€£₹]|Rs\.?\s?)\s?[\d.]+\s?(?:[MBK]\b|million|billion|mn\b|cr\b|crore)/i)?.[0];
  return { name, amount, headline: t, url: "" };
}

async function fundedCompanies(tf: TinyFish, p: Prefs, emit: Emit): Promise<Funded[]> {
  emit({ type: "status", message: "Scanning funding news for companies that just raised…" });
  const recency = Math.max(p.freshnessHours, 72) * 60;
  const queries = ["startup raises seed round", "raises Series A", "raises Series B funding"];
  const res = (await Promise.all(queries.map((q) =>
    tf.search({ query: q, domain_type: "news", recency_minutes: recency, purpose: "Find startups that announced new funding so we can check if they are hiring" }, `News: "${q}"`).catch(() => []),
  ))).flat();
  const seen = new Map<string, Funded>();
  for (const r of res) {
    const f = companyFromHeadline(r.title);
    if (!f) continue;
    const k = f.name.toLowerCase();
    if (!seen.has(k)) seen.set(k, { ...f, url: r.url, hoursAgo: hoursAgo(r.date) });
  }
  return [...seen.values()];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Located { f: Funded; ats?: Ats; board?: string; direct: string[] }

async function jobsFromFunded(tf: TinyFish, funded: Funded[], emit: Emit): Promise<{ jobs: Job[]; unreadable: Located[] }> {
  const top = funded.slice(0, 10);
  if (!top.length) return { jobs: [], unreadable: [] };
  emit({ type: "status", message: `Finding careers pages for ${top.length} freshly funded companies…` });

  // Which ATS does each funded company use?
  const located: Located[] = await Promise.all(top.map(async (f): Promise<Located> => {
    const r = await tf.search({ query: `${f.name} careers jobs`, include_domains: ALL_ATS_DOMAINS }, `Careers: ${f.name}`).catch(() => []);
    for (const x of r) {
      const hit = atsFor(x.url);
      if (!hit) continue;
      const slug = hit.ats.company(hit.u);
      if (norm(slug).includes(norm(f.name)) || norm(f.name).includes(norm(slug))) {
        const direct = r.map((y) => y.url.split("?")[0]).filter((u) => hit.ats.isJob.test(u) && u.toLowerCase().includes(slug.toLowerCase()));
        return { f, ats: hit.ats, board: hit.ats.board(hit.u), direct };
      }
    }
    return { f, direct: [] };
  }));

  const fetchable = located.filter((l) => l.ats?.fetchable && l.board);
  const boards = await tf.fetch(fetchable.map((l) => l.board!), "Read funded companies' job boards", { links: true, purpose: "List open job postings" });

  const jobUrls: { url: string; f: Funded; ats: Ats }[] = [];
  for (const l of fetchable) {
    const b = boards.get(l.board!);
    const links = [...new Set([...l.direct, ...(b?.links ?? []).filter((u) => l.ats!.isJob.test(u)).map((u) => u.split("?")[0])])];
    for (const url of links.slice(0, 12)) jobUrls.push({ url, f: l.f, ats: l.ats! });
  }
  const details = await tf.fetch(jobUrls.map((j) => j.url), "Read funded companies' postings", { purpose: "Extract job title, location and requirements" });

  const jobs: Job[] = [];
  for (const j of jobUrls) {
    const d = details.get(j.url);
    if (!d?.title) continue;
    jobs.push({
      id: hash(canonicalUrl(j.url)), title: d.title, company: j.f.name, url: j.url, source: j.ats.name,
      visa: "unknown", verified: "unverified", score: 0, reasons: [],
      funding: { amount: j.f.amount, headline: j.f.headline, url: j.f.url },
    });
  }
  return { jobs, unreadable: located.filter((l) => !l.ats?.fetchable || !l.board) };
}

/** Deep mode: Agent reads careers pages Fetch can't (custom sites or JS-rendered boards like Workable). */
async function agentCareers(tf: TinyFish, unreadable: Located[], p: Prefs): Promise<Job[]> {
  const out: Job[] = [];
  await Promise.all(unreadable.slice(0, 3).map(async (l) => {
    let start = l.board;
    if (!start) {
      const r = await tf.search({ query: `${l.f.name} careers` }, `Careers site: ${l.f.name}`).catch(() => []);
      start = r.find((x) => /career|jobs|join|hiring|work-with-us/i.test(x.url))?.url;
    }
    if (!start) return;
    const role = p.roles.join(" or ");
    const raw = await tf.agent(start,
      `This is (or links to) the careers page of ${l.f.name}. Close any cookie banner. Find the open job postings, clicking "open roles"/"see all jobs"/"show more" if needed. ` +
      `Return ONLY a JSON array of objects {"title","location","url"} for roles related to: ${role}. If none match, return up to 10 other open roles. Return [] if there are no jobs.`,
      `Agent: read ${l.f.name} careers page`, { maxSeconds: 120 });
    const list = agentJson<{ title: string; location?: string; url?: string }[]>(raw) ?? [];
    for (const x of list.slice(0, 10)) {
      if (!x?.title) continue;
      const url = x.url && /^https?:/.test(x.url) ? x.url : start;
      out.push({
        id: hash(canonicalUrl(url) + x.title), title: x.title, company: l.f.name, url, source: "Careers page (Agent)",
        location: x.location, visa: "unknown", verified: "live", score: 0, reasons: [],
        seniority: detectSeniority(x.title), remote: /remote/i.test(x.location ?? ""),
        funding: { amount: l.f.amount, headline: l.f.headline, url: l.f.url },
      });
    }
  }));
  return out;
}

// ---------- main ----------

export type PublishJobs = (jobs: Job[], stats: Stats, pending?: string) => void;

export async function findJobs(tf: TinyFish, p: Prefs, emit: Emit, publish: PublishJobs): Promise<void> {
  emit({ type: "status", message: "Searching company job boards for fresh postings…" });
  const recency = p.freshnessHours * 60;
  const roles = p.roles.length ? p.roles : ["software engineer"];

  const fundedP = fundedCompanies(tf, p, emit).catch(() => [] as Funded[]);

  const searches = roles.flatMap((role) => ATS.map((ats) =>
    tf.search({
      query: queryFor(role, p),
      include_domains: ats.domains,
      recency_minutes: recency,
      purpose: `Find open ${role} job postings${p.location ? ` in ${p.location}` : ""}`,
    }, `${ats.name}: "${queryFor(role, p)}"`).catch(() => [] as SearchResult[]),
  ));
  const raw = (await Promise.all(searches)).flat();
  let candidates = raw.map(fromSearch).filter((j): j is Job => !!j);

  const funded = await fundedP;
  const { jobs: fundedJobs, unreadable } = await jobsFromFunded(tf, funded, emit).catch(() => ({ jobs: [] as Job[], unreadable: [] as Located[] }));

  // Tag ATS hits whose company just raised.
  for (const j of candidates) {
    const f = funded.find((f) => norm(f.name) === norm(j.company) || norm(f.name) === norm(j.slug ?? ""));
    if (f) j.funding = { amount: f.amount, headline: f.headline, url: f.url };
  }
  candidates = [...candidates, ...fundedJobs];
  const totalCandidates = candidates.length;

  // Verify at the source: Fetch each plausible posting (Workable renders client-side, so it stays "unverified").
  const fits = (j: Job) => roles.some((r) => overlap(r, j.title) >= 0.5);
  const relevant = [
    ...candidates.filter((j) => j.funding && fits(j)).slice(0, 20),
    ...candidates
      .filter((j) => !j.funding && fits(j))
      .sort((a, b) => (a.postedHoursAgo ?? 999) - (b.postedHoursAgo ?? 999))
      .slice(0, 50),
  ];
  emit({ type: "status", message: `Reading ${relevant.length} postings at the source to verify they're live…` });
  const toRead = relevant.filter((j) => atsFor(j.url)?.ats.fetchable !== false).map((j) => j.url);
  const pages = await tf.fetch(toRead, "Verify postings + extract details", { images: true, purpose: "Check the job posting is still open and extract location, salary and visa sponsorship wording" });
  const mySkills = new Set(p.skills.map((x) => x.toLowerCase()));

  for (const j of relevant) {
    const d = pages.get(j.url);
    if (!d) continue;
    const text = d.text ?? "";
    const ats = atsFor(j.url)?.ats;
    const redirectedToBoard = !!(d.final_url && ats && !ats.isJob.test(d.final_url));
    if (CLOSED.test(text.slice(0, 2500)) || redirectedToBoard) { j.verified = "closed"; continue; }
    if (text.length < 200) continue;
    j.verified = "live";
    if (d.title && d.title.length < 140) j.title = cleanTitle(d.title, j.company);
    j.visa = detectVisa(text);
    j.salary = detectSalary(text.slice(0, 6000));
    j.location = extractLocation(text) ?? j.location;
    j.remote = /\bremote\b/i.test(`${j.location ?? ""} ${text.slice(0, 1200)}`);
    j.logo = pickLogo(d.image_links ?? []);
    if (mySkills.size) j.skillHits = findSkills(text).filter((k) => mySkills.has(k));
  }
  for (const j of relevant) j.seniority = detectSeniority(j.title);

  const stats = (r: ReturnType<typeof rankJobs>, extra = 0): Stats =>
    ({ ...r.stats, candidates: totalCandidates + extra, fundedCompanies: funded.length });

  const deepTargets = p.deep ? unreadable.slice(0, 3) : [];
  const first = rankJobs(relevant.map((j) => ({ ...j })), p);
  publish(first.jobs, stats(first), deepTargets.length ? `Agent is reading ${deepTargets.length} careers page(s) Fetch can't: ${deepTargets.map((l) => l.f.name).join(", ")}` : undefined);

  if (deepTargets.length) {
    const agentJobs = await agentCareers(tf, deepTargets, p).catch(() => [] as Job[]);
    const again = rankJobs([...relevant, ...agentJobs], p);
    publish(again.jobs, stats(again, agentJobs.length));
  }
}

/** Company logo from the posting's own images (ATS pages embed the employer's logo). */
export function pickLogo(imgs: string[]): string | undefined {
  const ok = imgs.filter((u) => /^https:/.test(u) && !/lever-logo|greenhouse-logo|ashby-logo|workday-logo|emoji|avatar|tracking|pixel|\.gif/i.test(u));
  return ok.find((u) => /logo|wordmark|org-theme|badge|brand|company_logos|small_logos/i.test(u));
}

function extractLocation(md: string): string | undefined {
  const head = md.slice(0, 1500);
  const m =
    head.match(/#+\s*Location\s*\n+\s*([^\n#]+)/i) ??
    head.match(/\blocations?\s*\n+\s*([^\n]{3,80})/i) ??
    head.match(/^#\s[^\n]+\n+\s*\*\s*([^\n]{3,80})/m) ??
    head.match(/Location[:\s]+\**\s*([A-Z][^\n|]{2,60})/);
  return m?.[1]?.replace(/\*+/g, "").trim().slice(0, 80);
}
