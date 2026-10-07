// Thin TinyFish client: Search, Fetch and Agent, with a shared in-memory cache
// and a call log so the UI can show exactly what TinyFish did for each scan.
import type { CallLog, Emit, Endpoint } from "./types";

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
const AGENT_URL = "https://agent.tinyfish.ai/v1/automation/run";

export interface SearchResult {
  position: number;
  site_name?: string;
  title: string;
  snippet?: string;
  url: string;
  date?: string;
  publisher?: string;
}

export interface FetchResult {
  url: string;
  final_url?: string;
  title?: string;
  description?: string;
  text?: string;
  links?: string[];
  published_date?: string | null;
}

export interface SearchParams {
  query: string;
  purpose?: string;
  include_domains?: string;
  exclude_domains?: string;
  recency_minutes?: number;
  domain_type?: "web" | "news";
  location?: string;
  page?: number;
}

const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = { search: 20 * 60_000, fetch: 3 * 3600_000, agent: 6 * 3600_000 };

function key(): string {
  const k = process.env.TINYFISH_API_KEY;
  if (!k) throw new Error("TINYFISH_API_KEY is not set");
  return k;
}

export class TinyFish {
  calls: Record<Endpoint, number> = { search: 0, fetch: 0, agent: 0 };
  constructor(private emit?: Emit) {}

  private log(l: CallLog) {
    if (!l.cached) this.calls[l.endpoint]++;
    this.emit?.({ type: "log", log: l });
  }

  private async cached<T>(endpoint: Endpoint, ck: string, label: string, run: () => Promise<T>, describe?: (v: T) => string): Promise<T> {
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL_MS[endpoint]) {
      this.log({ endpoint, label, ms: 0, cached: true, ok: true, detail: describe?.(hit.value as T) });
      return hit.value as T;
    }
    const t = Date.now();
    try {
      const v = await run();
      cache.set(ck, { at: Date.now(), value: v });
      this.log({ endpoint, label, ms: Date.now() - t, cached: false, ok: true, detail: describe?.(v) });
      return v;
    } catch (e) {
      this.log({ endpoint, label, ms: Date.now() - t, cached: false, ok: false, detail: String((e as Error).message).slice(0, 160) });
      throw e;
    }
  }

  search(p: SearchParams, label: string): Promise<SearchResult[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return this.cached("search", "s:" + qs.toString(), label, async () => {
      const r = await fetch(`${SEARCH_URL}?${qs}`, { headers: { "X-API-Key": key() } });
      if (!r.ok) throw new Error(`search ${r.status}: ${(await r.text()).slice(0, 120)}`);
      const d = (await r.json()) as { results?: SearchResult[] };
      return d.results ?? [];
    }, (v) => `${v.length} results`);
  }

  /** Fetch up to 10 URLs per request; larger lists are split into parallel batches. */
  async fetch(urls: string[], label: string, opts: { format?: "markdown" | "html"; links?: boolean; purpose?: string; timeoutMs?: number } = {}): Promise<Map<string, FetchResult>> {
    const out = new Map<string, FetchResult>();
    const batches: string[][] = [];
    for (let i = 0; i < urls.length; i += 10) batches.push(urls.slice(i, i + 10));
    await Promise.all(batches.map(async (batch, bi) => {
      const body = {
        urls: batch,
        format: opts.format ?? "markdown",
        links: opts.links ?? false,
        purpose: opts.purpose,
        per_url_timeout_ms: opts.timeoutMs ?? 40_000,
      };
      const res = await this.cached("fetch", "f:" + JSON.stringify(body), batches.length > 1 ? `${label} (${bi + 1}/${batches.length})` : label, async () => {
        const r = await fetch(FETCH_URL, {
          method: "POST",
          headers: { "X-API-Key": key(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`fetch ${r.status}: ${(await r.text()).slice(0, 120)}`);
        const d = (await r.json()) as { results?: FetchResult[] };
        return d.results ?? [];
      }, (v) => `${v.length}/${batch.length} pages read`).catch(() => [] as FetchResult[]);
      for (const x of res) out.set(x.url, x);
    }));
    return out;
  }

  /** Blocking Agent run. Costs credits, so callers gate it behind `deep` mode. */
  agent<T = unknown>(url: string, goal: string, label: string, opts: { stealth?: boolean; maxSeconds?: number } = {}): Promise<T | null> {
    const body = {
      url,
      goal,
      browser_profile: opts.stealth === false ? "lite" : "stealth",
      agent_config: { max_duration_seconds: opts.maxSeconds ?? 150 },
    };
    return this.cached("agent", "a:" + JSON.stringify(body), label, async () => {
      const r = await fetch(AGENT_URL, {
        method: "POST",
        headers: { "X-API-Key": key(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(((opts.maxSeconds ?? 150) + 45) * 1000),
      });
      if (!r.ok) throw new Error(`agent ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const d = (await r.json()) as { status: string; result: unknown; error: unknown };
      if (d.status !== "COMPLETED") throw new Error(`agent ${d.status}: ${JSON.stringify(d.error).slice(0, 120)}`);
      return d.result as T;
    }, () => "completed").catch(() => null);
  }
}

/**
 * Agent results come back either as the requested JSON or wrapped as
 * `{ result: "<text>" }`. Pull the first JSON array/object out of whichever we got.
 */
export function agentJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !("result" in (raw as object) && typeof (raw as { result: unknown }).result === "string")) return raw as T;
  const text = typeof raw === "string" ? raw : String((raw as { result: string }).result);
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as T;
  } catch {
    return null;
  }
}
