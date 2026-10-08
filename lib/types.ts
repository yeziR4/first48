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
  skills: string[]; // from the visitor's profile, used to personalise ranking
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
  logo?: string;
  skillHits?: string[];
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
  image?: string;
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

export interface Profile {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  headline?: string;
  bio?: string;
  avatar?: string;
  workAuth?: string; // e.g. "Need sponsorship" / "Authorized to work in the US"
  links: { linkedin?: string; github?: string; x?: string; portfolio?: string; other?: string };
  resumeText?: string;
  resumeUrl?: string;
  skills: string[];
  projects: { name: string; url?: string; description?: string }[];
  sources: { url: string; ok: boolean; note?: string }[];
}

export type ApplyEvent =
  | { type: "status"; message: string }
  | { type: "fit"; matched: string[]; missing: string[]; title?: string; company?: string }
  | { type: "stream"; url: string }
  | { type: "progress"; message: string }
  | { type: "result"; result: ApplyResult }
  | { type: "error"; message: string };

export interface ApplyResult {
  status: "submitted" | "filled_not_submitted" | "blocked" | "failed";
  filled: { field: string; value: string }[];
  needsYou: string[];
  confirmation?: string;
  summary?: string;
}
