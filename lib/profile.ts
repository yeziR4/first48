// Build a candidate profile from the links people already keep up to date
// (GitHub, LinkedIn, portfolio, X). TinyFish Fetch reads each page; we extract
// name, headline, skills and projects. Nothing is stored server-side.
import type { TinyFish } from "./tinyfish";
import type { Profile } from "./types";

// Skills we look for in profiles and job postings. Lowercase; matched on word boundaries.
export const SKILLS = [
  // languages
  "python", "javascript", "typescript", "java", "kotlin", "swift", "golang", "rust", "c++", "c#", "ruby", "php", "scala", "elixir", "sql", "dart", "solidity",
  // web / mobile
  "react", "next.js", "vue", "angular", "svelte", "node.js", "express", "django", "flask", "fastapi", "rails", "spring", "graphql", "rest api", "tailwind", "html", "css",
  "react native", "flutter", "ios", "android",
  // data / ml
  "machine learning", "deep learning", "pytorch", "tensorflow", "jax", "scikit-learn", "pandas", "numpy", "llm", "nlp", "computer vision", "rag", "langchain",
  "data analysis", "data engineering", "spark", "airflow", "dbt", "snowflake", "bigquery", "tableau", "power bi", "statistics", "a/b testing",
  // infra
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "linux", "postgres", "postgresql", "mysql", "mongodb", "redis", "kafka", "ci/cd", "microservices",
  "distributed systems", "cybersecurity", "devops",
  // product / design / other
  "figma", "ui/ux", "product design", "user research", "product management", "growth marketing", "seo", "copywriting", "content marketing",
  "web3", "blockchain", "agents", "automation", "web scraping",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SKILL_RE = SKILLS.map((s) => [s, new RegExp(`(^|[^a-z0-9+#])${esc(s)}(?![a-z0-9+#])`, "i")] as const);

export function findSkills(text: string): string[] {
  const found = SKILL_RE.filter(([, re]) => re.test(text)).map(([s]) => s);
  // Collapse aliases.
  return [...new Set(found.map((s) => ({ postgresql: "postgres" } as Record<string, string>)[s] ?? s))];
}

function normalizeUrl(u?: string, host?: string): string | undefined {
  if (!u?.trim()) return undefined;
  let v = u.trim();
  if (host && !/^https?:/i.test(v) && !v.includes(".")) v = `https://${host}/${v.replace(/^@/, "")}`;
  if (!/^https?:/i.test(v)) v = `https://${v}`;
  try {
    return new URL(v).toString();
  } catch {
    return undefined;
  }
}

export function cleanLinks(l: Profile["links"]): Profile["links"] {
  return {
    // Always read the profile page itself (not ?tab=repositories etc.): it has the name, bio and pinned repos.
    github: ((u) => (u ? `https://github.com/${new URL(u).pathname.split("/").filter(Boolean)[0] ?? ""}` : undefined))(normalizeUrl(l.github, "github.com")),
    linkedin: normalizeUrl(l.linkedin, "www.linkedin.com/in"),
    x: normalizeUrl(l.x, "x.com"),
    portfolio: normalizeUrl(l.portfolio),
    other: normalizeUrl(l.other),
  };
}

export async function buildProfile(tf: TinyFish, input: Partial<Profile>): Promise<Profile> {
  const links = cleanLinks(input.links ?? {});
  const targets = Object.entries(links).filter(([, v]) => v) as [keyof Profile["links"] | "githubRepos", string][];
  // The repositories tab lists every repo with its description, which surfaces more skills and better project blurbs.
  if (links.github) targets.push(["githubRepos", `${links.github}?tab=repositories`]);
  const pages = await tf.fetch(targets.map(([, u]) => u), "Read your profile links", { links: true, purpose: "Build a job applicant profile: name, headline, skills and projects" });

  const p: Profile = {
    ...input,
    links,
    skills: [],
    projects: [],
    sources: [],
  };
  const allText: string[] = [input.resumeText ?? ""];

  for (const [kind, url] of targets) {
    const d = pages.get(url);
    const text = d?.text ?? "";
    const blocked = !d || text.length < 400 || /enable javascript|sign in to view/i.test(text.slice(0, 400)) && kind !== "linkedin";
    if (kind !== "githubRepos") p.sources.push({ url, ok: !blocked, note: blocked ? (kind === "x" ? "X needs JavaScript; kept as a link" : "Couldn't read; kept as a link") : undefined });
    if (blocked) continue;
    allText.push(text, d?.description ?? "");

    if (kind === "github" || kind === "githubRepos") {
      const name = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      if (kind === "github" && name && !p.name) p.name = name;
      if (kind === "github" && !p.bio && d?.description && !/has \d+ repositories available/i.test(d.description)) p.bio = d.description.replace(/\s+-\s+\S+$/, "");
      const repoBase = new URL(url).pathname.split("/").filter(Boolean)[0];
      const repos = [...new Set((d?.links ?? []).filter((l) => new RegExp(`^https://github\\.com/${repoBase}/[^/#?]+$`, "i").test(l)))]
        .filter((l) => !/\/(followers|following|repositories|projects|packages|stars|sponsoring)$/i.test(l) && !/[?=]/.test(l));
      for (const r of repos.slice(0, 10)) {
        const repo = r.split("/").pop()!;
        if (repo.toLowerCase() === repoBase.toLowerCase()) continue;
        const descRaw = text.match(new RegExp(`${esc(repo)}[^\\n]*\\n+([^\\n#*][^\\n]{10,160})`, "i"))?.[1]?.trim();
        // Skip "descriptions" that are just the repo name or its language.
        const description = descRaw && descRaw.toLowerCase() !== repo.toLowerCase() && !/^(typescript|javascript|python|html|css|rust|go|java|solidity|jupyter notebook|shell)$/i.test(descRaw) ? descRaw : undefined;
        const prev = p.projects.find((x) => x.name === repo);
        if (prev) prev.description ??= description;
        else p.projects.push({ name: repo, url: r, description });
      }
      // GitHub avatar is predictable and public.
      p.avatar ??= `https://github.com/${repoBase}.png?size=160`;
    }
    if (kind === "linkedin") {
      const t = d?.title?.split("|")[0]?.trim();
      if (t?.includes(" - ")) {
        const [n, ...h] = t.split(" - ");
        p.name ??= n.trim();
        p.headline ??= h.join(" - ").trim();
      }
      if (!p.bio && d?.description) p.bio = d.description.slice(0, 280);
    }
    if (kind === "portfolio" || kind === "other") {
      p.name ??= d?.title?.split(/[|–-]/)[0]?.trim();
      p.headline ??= text.match(/^##\s+(.+)$/m)?.[1]?.trim().slice(0, 140);
    }
  }

  // Show described projects first.
  p.projects = [...p.projects.filter((x) => x.description), ...p.projects.filter((x) => !x.description)].slice(0, 8);
  p.skills = [...new Set([...(input.skills ?? []), ...findSkills(allText.join("\n"))])].slice(0, 30);
  return p;
}
