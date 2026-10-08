import type { Seniority, Visa } from "./types";

const UNITS: Record<string, number> = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720, year: 8760 };

/** "8 hours ago" / "3 days ago" / "Mar 15, 2026" -> hours since then. */
export function hoursAgo(label?: string, now = Date.now()): number | undefined {
  if (!label) return undefined;
  const rel = label.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
  if (rel) return Number(rel[1]) * UNITS[rel[2].toLowerCase()];
  if (/just now|today/i.test(label)) return 1;
  if (/yesterday/i.test(label)) return 24;
  const t = Date.parse(label);
  return Number.isNaN(t) ? undefined : Math.max(0, (now - t) / 3_600_000);
}

export function ageLabel(h?: number): string | undefined {
  if (h === undefined) return undefined;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (u.hostname === "boards.greenhouse.io") u.hostname = "job-boards.greenhouse.io";
    let p = u.pathname.replace(/\/(apply|application)\/?$/, "").replace(/\/en-[A-Z]{2}\//, "/").replace(/\/+$/, "");
    u.pathname = p || "/";
    return u.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

const STOP = new Set(["the", "and", "of", "for", "a", "an", "to", "in", "at", "with", "on", "or", "&", "-", "–", "/", "ii", "iii", "i"]);

export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));
}

/** Fraction of `needle` tokens present in `hay`, treating "engineer"/"engineering" etc. as equal. */
export function overlap(needle: string, hay: string): number {
  const n = tokens(needle);
  if (!n.length) return 0;
  const h = tokens(hay).map(stem);
  return n.filter((t) => h.includes(stem(t))).length / n.length;
}

function stem(t: string): string {
  return t.replace(/(ing|er|ers|s)$/, "");
}

export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function detectSeniority(title: string): Seniority | undefined {
  const t = title.toLowerCase();
  if (/\b(intern|internship|co-?op|placement)\b/.test(t)) return "intern";
  if (/\b(new grad|graduate|entry|junior|jr\.?|early career|associate|apprentice|university grad)\b/.test(t)) return "entry";
  if (/\b(senior|sr\.?|staff|principal|lead|head|director|manager|vp|architect)\b/.test(t)) return "senior";
  if (/\b(ii|2|mid)\b/.test(t)) return "mid";
  return undefined;
}

const NO_SPONSOR = [
  /(unable|not able|cannot|can ?not|won'?t|will not|do(?:es)? not|are not able)( to)? (provide |offer )?(visa )?sponsor/i,
  /no (visa )?sponsorship/i,
  /without (the need for )?(current or future )?(visa )?sponsorship/i,
  /sponsorship (is )?not (available|offered|provided)/i,
  /must (be|have) (a )?(u\.?s\.? citizen|citizenship|permanent resident)/i,
  /(active|current) (security )?clearance (is )?required/i,
];
const SPONSORS = [
  /visa sponsorship (is )?(available|offered|provided)/i,
  /(we|will|can|able to|happy to) (provide |offer )?(visa )?sponsor/i,
  /sponsorship (is )?available/i,
  /(support|assist)(s)? (with )?(work )?visa/i,
  /relocation (and|&) visa/i,
];

export function detectVisa(text: string): Visa {
  if (NO_SPONSOR.some((r) => r.test(text))) return "no-sponsor";
  if (SPONSORS.some((r) => r.test(text))) return "sponsors";
  return "unknown";
}

export function detectSalary(text: string): string | undefined {
  for (const m of text.matchAll(/(?:[$£€]\s?\d[\d,.]*\s?[kK]?(?:\s?(?:–|-|to)\s?[$£€]?\s?\d[\d,.]*\s?[kK]?)?)/g)) {
    const ok = salaryOk(m[0]);
    if (ok) return ok;
  }
  return undefined;
}

function salaryOk(raw: string): string | undefined {
  const m = raw.match(/(?:[$£€]\s?\d[\d,.]*\s?[kK]?(?:\s?(?:–|-|to)\s?[$£€]?\s?\d[\d,.]*\s?[kK]?)?)(?:\s?(?:USD|GBP|EUR|\/yr|\/year|per year|annually))?/);
  if (!m) return undefined;
  const v = m[0].trim();
  // Only accept plausible pay: a "k" amount or a figure of at least 15,000 (ignores "$30 credit", "$50-200").
  const first = v.match(/\d[\d,]*(?:\.\d+)?\s?[kK]?/)?.[0] ?? "";
  const n = Number(first.replace(/[^\d.]/g, "")) * (/k/i.test(first) ? 1000 : 1);
  return n >= 15000 ? v.replace(/[.,]$/, "") : undefined;
}

export const CLOSED = /(no longer (accepting|available|open)|position (has been )?filled|job (is )?(closed|not found|has expired)|this job (posting )?(is no longer|has been removed)|page (you|you're) looking for (doesn't|does not) exist|couldn't find (that|this) job|error=true)/i;

export function titleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function money(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return undefined;
  const mult = m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1;
  return Number(m[1]) * mult;
}
