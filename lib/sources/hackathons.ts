// Hackathons lane.
//  - Devpost: Fetch its public listing of open/upcoming hackathons (structured: dates, themes, prizes).
//  - Luma + Eventbrite: Search for recently listed hackathon events, then Fetch each page
//    to get the event date and drop ones that already happened.
import type { SearchResult, TinyFish } from "../tinyfish";
import type { Emit, Hackathon, Prefs } from "../types";
import { ageLabel, canonicalUrl, hash, hoursAgo, money, overlap } from "../util";

interface DevpostHackathon {
  title: string;
  url: string;
  open_state: string;
  displayed_location?: { location?: string };
  submission_period_dates?: string;
  time_left_to_submission?: string;
  themes?: { name: string }[];
  prize_amount?: string;
  registrations_count?: number;
  organization_name?: string;
  invite_only?: boolean;
  thumbnail_url?: string;
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE_RE = new RegExp(`(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+)?${MONTH}\\s+\\d{1,2}(?:\\s*[-–]\\s*(?:${MONTH}\\s+)?\\d{1,2})?(?:,?\\s+\\d{4})?`, "i");
const ENDED = /(this (hackathon|event) (has )?ended|event (has )?ended|past event|sales ended|registration (is )?closed|event is over)/i;

function themeOf(p: Prefs): string {
  if (p.keywords.length) return p.keywords.slice(0, 2).join(" ");
  if (p.roles.some((r) => /\b(ml|ai|machine|data|llm)\b/i.test(r))) return "AI";
  return "";
}

async function devpost(tf: TinyFish, p: Prefs, theme: string): Promise<Hackathon[]> {
  const base = "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&order_by=recently-added&per_page=40";
  const urls = [base, ...(theme ? [`${base}&search=${encodeURIComponent(theme)}`] : [])];
  const pages = await tf.fetch(urls, "Devpost: open + upcoming hackathons", { purpose: "List open hackathons with dates, prizes and themes" });

  const seen = new Set<string>();
  const out: Hackathon[] = [];
  for (const page of pages.values()) {
    let list: DevpostHackathon[] = [];
    try {
      list = (JSON.parse((page.text ?? "").replace(/\\_/g, "_")) as { hackathons: DevpostHackathon[] }).hackathons ?? [];
    } catch { continue; }
    for (const h of list) {
      if (seen.has(h.url) || h.invite_only) continue;
      seen.add(h.url);
      const where = h.displayed_location?.location ?? "";
      const online = /online/i.test(where);
      const prize = (h.prize_amount ?? "").replace(/<[^>]+>/g, "");
      const prizeUsd = money(prize);
      const themes = (h.themes ?? []).map((t) => t.name);
      const reasons: string[] = [];
      let score = 20;
      if (theme) {
        const fit = Math.max(overlap(theme, `${h.title} ${themes.join(" ")}`), themes.some((t) => overlap(theme, t) > 0.5) ? 1 : 0);
        score += fit * 25;
        if (fit > 0.5) reasons.push(`Theme: ${themes.find((t) => overlap(theme, t) > 0.5) ?? theme}`);
      }
      const place = p.location && !/remote/i.test(p.location) ? p.location : "";
      if (online) { score += 15; reasons.push("Online — join from anywhere"); }
      else if (place && overlap(place, where) >= 0.5) { score += 15; reasons.push(`In ${where}`); }
      else if (place) score -= 10;
      if (prizeUsd) { score += Math.min(20, Math.log10(prizeUsd) * 4); reasons.push(`${prize} in prizes`); }
      if (h.open_state === "open") { score += 5; reasons.push(h.time_left_to_submission ?? "Open now"); }
      if ((h.registrations_count ?? 0) < 150) { score += 5; reasons.push(`${h.registrations_count ?? 0} registered — low competition`); }
      out.push({
        id: hash(h.url), title: h.title, url: h.url, source: "Devpost", host: h.organization_name, online,
        image: h.thumbnail_url && !/placeholder/.test(h.thumbnail_url) ? (h.thumbnail_url.startsWith("//") ? `https:${h.thumbnail_url}` : h.thumbnail_url) : undefined,
        location: online ? "Online" : where, prize: prizeUsd ? prize : undefined, dates: h.submission_period_dates,
        score: Math.round(Math.min(100, score)), reasons,
      });
    }
  }
  return out;
}

const EVENT_SITES = [
  { name: "Luma", domains: "lu.ma,luma.com", isEvent: (u: URL) => u.pathname.split("/").filter(Boolean).length === 1 && !/^\/(discover|home|signin|create|pricing|explore|ai|tech|[a-z]{2}-[a-z]{2})$/i.test(u.pathname) },
  { name: "Eventbrite", domains: "eventbrite.com", isEvent: (u: URL) => /\/e\//.test(u.pathname) },
];

async function events(tf: TinyFish, p: Prefs, theme: string): Promise<Hackathon[]> {
  const place = p.location && !/remote/i.test(p.location) ? p.location : "";
  const q = [theme, "hackathon", place].filter(Boolean).join(" ");
  const res: { r: SearchResult; source: string }[] = [];
  await Promise.all(EVENT_SITES.map(async (s) => {
    const rs = await tf.search({ query: q, include_domains: s.domains, recency_minutes: 30 * 24 * 60, purpose: "Find upcoming hackathons open for registration" }, `${s.name}: "${q}"`).catch(() => []);
    for (const r of rs) {
      try { if (s.isEvent(new URL(r.url))) res.push({ r, source: s.name }); } catch { /* ignore */ }
    }
  }));
  const picks = [...new Map(res.map((x) => [canonicalUrl(x.r.url), x])).values()].slice(0, 16);
  const pages = await tf.fetch(picks.map((x) => x.r.url), "Read event pages", { images: true, purpose: "Extract the event date, location and whether it already happened" });

  const out: Hackathon[] = [];
  for (const { r, source } of picks) {
    const d = pages.get(r.url);
    const text = d?.text ?? "";
    if (!text || ENDED.test(text.slice(0, 3000))) continue;
    const dateStr = text.match(DATE_RE)?.[0];
    const when = dateStr ? Date.parse(/\d{4}/.test(dateStr) ? dateStr : `${dateStr} ${new Date().getFullYear()}`) : NaN;
    if (!Number.isNaN(when) && when < Date.now() - 86_400_000) continue; // already happened
    const online = /\b(online|virtual|remote)\b/i.test(`${r.title} ${text.slice(0, 1500)}`);
    const prizeM = text.match(/[$€£]\s?[\d,]+(?:\.\d+)?\s?[kK]?(?=\s*(?:in prizes|in cash|prize|total))/i);
    const h = hoursAgo(r.date);
    const reasons: string[] = [];
    let score = 25;
    if (theme && overlap(theme, `${r.title} ${text.slice(0, 1200)}`) > 0.5) { score += 20; reasons.push(`About ${theme}`); }
    if (online) { score += 15; reasons.push("Online"); }
    if (place && overlap(place, text.slice(0, 2500)) >= 0.5) { score += 15; reasons.push(`In ${place}`); }
    if (prizeM) { score += 10; reasons.push(`${prizeM[0]} in prizes`); }
    if (h !== undefined && h <= 168) { score += 10; reasons.push("Listed this week"); }
    out.push({
      id: hash(canonicalUrl(r.url)), title: (d?.title || r.title).replace(/\s*[|·]\s*(Luma|Eventbrite).*$/i, "").replace(/ Tickets,.*$/i, "").slice(0, 120),
      url: r.url.split("?")[0], source, online, prize: prizeM?.[0], dates: dateStr,
      image: d?.image_links?.find((u) => /^https:/.test(u) && /\.(jpe?g|png|webp)|images\.lumacdn|img\.evbuc|cdn\.lu\.ma/i.test(u) && !/avatar|logo|icon/i.test(u)),
      postedHoursAgo: h, postedLabel: ageLabel(h), score: Math.round(Math.min(100, score)), reasons,
    });
  }
  return out;
}

export async function findHackathons(tf: TinyFish, p: Prefs, emit: Emit): Promise<Hackathon[]> {
  emit({ type: "status", message: "Finding open hackathons…" });
  const theme = themeOf(p);
  const [a, b] = await Promise.all([devpost(tf, p, theme).catch(() => []), events(tf, p, theme).catch(() => [])]);
  return [...a, ...b].sort((x, y) => y.score - x.score).slice(0, 40);
}
