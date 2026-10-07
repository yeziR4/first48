export type Seniority = "any" | "intern" | "entry" | "mid" | "senior";
export type Freshness = 24 | 48 | 168;

export interface Prefs {
  roles: string[]; // e.g. ["software engineer", "ml engineer"]
  keywords: string[]; // nice-to-have terms, e.g. ["python", "llm"]
  location: string; // "" = anywhere, "remote", or a city/country
  seniority: Seniority;
  needsVisa: boolean;
  freshnessHours: Freshness;
  lanes: { jobs: boolean; hackathons: boolean; bounties: boolean };
  deep: boolean; // allow paid Agent runs
}

export type Endpoint = "search" | "fetch" | "agent";

export interface CallLog {
  endpoint: Endpoint;
  label: string;
  ms: number;
  cached: boolean;
  ok: boolean;
  detail?: string;
}

export type Visa = "sponsors" | "no-sponsor" | "unknown";

export interface Job {
  id: string;
  title: string;
  company: string;
  slug?: string;
  url: string;
  source: string; // ATS / portal name
  location?: string;
  remote?: boolean;
  salary?: string;
  seniority?: Seniority;
  visa: Visa;
  postedHoursAgo?: number;
  postedLabel?: string;
  verified: "live" | "closed" | "unverified";
  funding?: { amount?: string; headline: string; url: string };
  snippet?: string;
  score: number;
  reasons: string[];
  alsoOn?: string[]; // duplicate sources merged into this one
}

export interface Hackathon {
  id: string;
  title: string;
  url: string;
  source: string;
  host?: string;
  online?: boolean;
  location?: string;
  prize?: string;
  dates?: string;
  postedLabel?: string;
  postedHoursAgo?: number;
  score: number;
  reasons: string[];
}

export interface Bounty {
  id: string;
  title: string;
  url: string;
  source: string;
  poster?: string;
  reward?: string;
  rewardUsd?: number;
  solvers?: number;
  spotsLeft?: number;
  score: number;
  reasons: string[];
}

export interface Stats {
  candidates: number;
  duplicatesMerged: number;
  closedRemoved: number;
  visaFiltered: number;
  seniorityFiltered: number;
  fundedCompanies: number;
}

export type ScanEvent =
  | { type: "log"; log: CallLog }
  | { type: "status"; message: string }
  | { type: "jobs"; items: Job[]; stats: Stats; pending?: string }
  | { type: "hackathons"; items: Hackathon[] }
  | { type: "bounties"; items: Bounty[]; pending?: string }
  | { type: "error"; message: string }
  | { type: "done"; ms: number; calls: Record<Endpoint, number> };

export type Emit = (e: ScanEvent) => void;
