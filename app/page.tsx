"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Bounty, CallLog, Endpoint, Hackathon, Job, ScanEvent, Stats } from "@/lib/types";

type Tab = "jobs" | "hackathons" | "bounties";

interface Form {
  roles: string;
  keywords: string;
  location: string;
  seniority: string;
  freshnessHours: number;
  needsVisa: boolean;
  deep: boolean;
  lanes: { jobs: boolean; hackathons: boolean; bounties: boolean };
}

const DEFAULT_FORM: Form = {
  roles: "software engineer",
  keywords: "",
  location: "",
  seniority: "any",
  freshnessHours: 48,
  needsVisa: false,
  deep: false,
  lanes: { jobs: true, hackathons: true, bounties: true },
};

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* private mode */ }
  },
};

export default function Home() {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [calls, setCalls] = useState<Record<Endpoint, number>>({ search: 0, fetch: 0, agent: 0 });
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [hacks, setHacks] = useState<Hackathon[] | null>(null);
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const [pending, setPending] = useState<{ jobs?: string; bounties?: string }>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("jobs");
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [onlyLive, setOnlyLive] = useState(false);
  const [onlyFunded, setOnlyFunded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setForm(store.get("f48:form", DEFAULT_FORM));
    setSeen(new Set(store.get<string[]>("f48:seen", [])));
    setCode(store.get("f48:code", ""));
  }, []);

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const i = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(i);
  }, [running]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function run() {
    store.set("f48:form", form);
    setRunning(true);
    setStatus("Starting…");
    setLogs([]);
    setErrors([]);
    setCalls({ search: 0, fetch: 0, agent: 0 });
    setJobs(form.lanes.jobs ? null : []);
    setHacks(form.lanes.hackathons ? null : []);
    setBounties(form.lanes.bounties ? null : []);
    setStats(null);
    setPending({});
    const ac = new AbortController();
    abortRef.current = ac;
    const allIds: string[] = [];

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": code },
        body: JSON.stringify({ ...form, roles: form.roles.split(","), keywords: form.keywords.split(",") }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) setNeedCode(true);
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const e = JSON.parse(line.slice(6)) as ScanEvent;
          switch (e.type) {
            case "log":
              setLogs((l) => [e.log, ...l].slice(0, 200));
              if (!e.log.cached) setCalls((c) => ({ ...c, [e.log.endpoint]: c[e.log.endpoint] + 1 }));
              break;
            case "status": setStatus(e.message); break;
            case "jobs":
              setJobs(e.items); setStats(e.stats); setPending((p) => ({ ...p, jobs: e.pending }));
              allIds.push(...e.items.map((x) => x.id));
              break;
            case "hackathons": setHacks(e.items); allIds.push(...e.items.map((x) => x.id)); break;
            case "bounties":
              setBounties(e.items); setPending((p) => ({ ...p, bounties: e.pending }));
              allIds.push(...e.items.map((x) => x.id));
              break;
            case "error": setErrors((x) => [...x, e.message]); break;
            case "done": setStatus(`Done in ${Math.round(e.ms / 1000)}s`); break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErrors((x) => [...x, (e as Error).message]);
      setStatus("");
    } finally {
      setRunning(false);
      // Remember what this visitor has seen so the next scan can flag what's new.
      const next = [...new Set([...store.get<string[]>("f48:seen", []), ...allIds])].slice(-3000);
      store.set("f48:seen", next);
    }
  }

  const shownJobs = useMemo(
    () => (jobs ?? []).filter((j) => (!onlyLive || j.verified === "live") && (!onlyFunded || j.funding)),
    [jobs, onlyLive, onlyFunded],
  );
  const isNew = (id: string) => seen.size > 0 && !seen.has(id);

  function exportCsv() {
    const rows = [["score", "title", "company", "location", "posted", "verified", "visa", "salary", "funding", "source", "url"]];
    for (const j of shownJobs) rows.push([String(j.score), j.title, j.company, j.location ?? "", j.postedLabel ?? "", j.verified, j.visa, j.salary ?? "", j.funding?.amount ?? (j.funding ? "yes" : ""), j.source, j.url]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "first48-jobs.csv";
    a.click();
  }

  const started = running || jobs !== null || hacks !== null || bounties !== null;

  return (
    <main>
      <header className="hero">
        <div className="brand"><span className="dot" /> First 48</div>
        <h1>Find the roles, hackathons and bounties that opened <em>since yesterday</em>.</h1>
        <p className="sub">
          Straight from company careers pages, not aggregator reposts. Every listing is checked at the source and
          ranked by fit and freshness. Companies that just raised money get flagged, because they&apos;re hiring next.
        </p>
      </header>

      <section className="card form">
        <div className="grid">
          <label>Role(s)<input value={form.roles} onChange={(e) => set("roles", e.target.value)} placeholder="software engineer, data scientist" /></label>
          <label>Location<input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Remote, London, New York… (blank = anywhere)" /></label>
          <label>Keywords <span className="muted">(optional)</span><input value={form.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="python, llm, fintech" /></label>
          <label>Seniority
            <select value={form.seniority} onChange={(e) => set("seniority", e.target.value)}>
              <option value="any">Any</option><option value="intern">Internship</option><option value="entry">Entry / new grad</option>
              <option value="mid">Mid</option><option value="senior">Senior+</option>
            </select>
          </label>
          <label>Posted within
            <select value={form.freshnessHours} onChange={(e) => set("freshnessHours", Number(e.target.value))}>
              <option value={24}>24 hours</option><option value={48}>48 hours</option><option value={168}>7 days</option>
            </select>
          </label>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={form.needsVisa} onChange={(e) => set("needsVisa", e.target.checked)} /> I need visa sponsorship</label>
            <label className="check"><input type="checkbox" checked={form.deep} onChange={(e) => set("deep", e.target.checked)} /> Deep mode <span className="muted">(TinyFish Agent reads pages Fetch can&apos;t; +1–3 min)</span></label>
          </div>
        </div>
        <div className="row">
          <div className="lanes">
            {(["jobs", "hackathons", "bounties"] as const).map((l) => (
              <label key={l} className={`chip ${form.lanes[l] ? "on" : ""}`}>
                <input type="checkbox" checked={form.lanes[l]} onChange={(e) => set("lanes", { ...form.lanes, [l]: e.target.checked })} />
                {l[0].toUpperCase() + l.slice(1)}
              </label>
            ))}
          </div>
          {needCode && (
            <input className="code" value={code} placeholder="Access code" onChange={(e) => { setCode(e.target.value); store.set("f48:code", e.target.value); }} />
          )}
          {running
            ? <button className="btn ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
            : <button className="btn" onClick={run} disabled={!form.roles.trim()}>Scan the live web →</button>}
        </div>
      </section>

      {started && (
        <section className="card activity">
          <div className="activity-head">
            <div>
              <strong>{running ? <><span className="spin" /> {status}</> : status || "Finished"}</strong>
              {running && <span className="muted"> · {elapsed}s</span>}
            </div>
            <div className="counters">
              <span className="pill search">Search × {calls.search}</span>
              <span className="pill fetch">Fetch × {calls.fetch}</span>
              <span className="pill agent">Agent × {calls.agent}</span>
            </div>
          </div>
          <details>
            <summary>Live TinyFish call log ({logs.length})</summary>
            <ul className="log">
              {logs.map((l, i) => (
                <li key={i} className={l.ok ? "" : "bad"}>
                  <span className={`pill ${l.endpoint}`}>{l.endpoint}</span> {l.label}
                  <span className="muted"> — {l.ok ? l.detail : `failed: ${l.detail}`} {l.cached ? "(cached)" : `(${(l.ms / 1000).toFixed(1)}s)`}</span>
                </li>
              ))}
            </ul>
          </details>
          {errors.map((e, i) => <p key={i} className="error">{e}</p>)}
        </section>
      )}

      {started && (
        <>
          <nav className="tabs">
            <button className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")}>Jobs {jobs ? `(${jobs.length})` : "…"}</button>
            <button className={tab === "hackathons" ? "on" : ""} onClick={() => setTab("hackathons")}>Hackathons {hacks ? `(${hacks.length})` : "…"}</button>
            <button className={tab === "bounties" ? "on" : ""} onClick={() => setTab("bounties")}>Bounties {bounties ? `(${bounties.length})` : "…"}</button>
          </nav>

          {tab === "jobs" && (
            <section>
              {stats && (
                <div className="funnel">
                  <span><b>{stats.candidates}</b> postings found</span>→
                  <span><b>{stats.duplicatesMerged}</b> duplicates merged</span>→
                  <span><b>{stats.closedRemoved}</b> closed listings removed</span>→
                  {stats.visaFiltered > 0 && <><span><b>{stats.visaFiltered}</b> &ldquo;no sponsorship&rdquo; hidden</span>→</>}
                  {stats.seniorityFiltered > 0 && <><span><b>{stats.seniorityFiltered}</b> wrong level hidden</span>→</>}
                  <span className="final"><b>{jobs?.length ?? 0}</b> ranked for you</span>
                  <span className="muted">· {stats.fundedCompanies} companies raised money this week</span>
                </div>
              )}
              {pending.jobs && <p className="pending"><span className="spin" /> {pending.jobs}</p>}
              {jobs && jobs.length > 0 && (
                <div className="toolbar">
                  <label className="check"><input type="checkbox" checked={onlyLive} onChange={(e) => setOnlyLive(e.target.checked)} /> Verified live only</label>
                  <label className="check"><input type="checkbox" checked={onlyFunded} onChange={(e) => setOnlyFunded(e.target.checked)} /> Just-funded companies only</label>
                  <button className="btn ghost small" onClick={exportCsv}>Export CSV</button>
                </div>
              )}
              {jobs === null ? <Skeleton /> : shownJobs.length === 0 ? <Empty /> : shownJobs.map((j) => <JobCard key={j.id} j={j} isNew={isNew(j.id)} />)}
            </section>
          )}

          {tab === "hackathons" && (
            <section>
              {hacks === null ? <Skeleton /> : hacks.length === 0 ? <Empty /> : hacks.map((h) => (
                <article key={h.id} className="item">
                  <Score n={h.score} />
                  <div className="body">
                    <h3><a href={h.url} target="_blank" rel="noreferrer">{h.title}</a>{isNew(h.id) && <span className="badge new">New</span>}</h3>
                    <div className="meta">
                      {h.host && <span>{h.host}</span>}
                      {h.dates && <span>📅 {h.dates}</span>}
                      <span>{h.online ? "🌍 Online" : `📍 ${h.location || "In person"}`}</span>
                      {h.prize && <span className="badge money">{h.prize} prizes</span>}
                      <span className="muted">via {h.source}</span>
                    </div>
                    <p className="reasons">{h.reasons.join(" · ")}</p>
                  </div>
                  <a className="btn small" href={h.url} target="_blank" rel="noreferrer">Register</a>
                </article>
              ))}
            </section>
          )}

          {tab === "bounties" && (
            <section>
              {pending.bounties && <p className="pending"><span className="spin" /> {pending.bounties}</p>}
              {bounties === null ? <Skeleton /> : bounties.length === 0 ? <Empty text="No open bounties on the tracked boards right now." /> : bounties.map((b) => (
                <article key={b.id} className="item">
                  <Score n={b.score} />
                  <div className="body">
                    <h3><a href={b.url} target="_blank" rel="noreferrer">{b.title}</a>{isNew(b.id) && <span className="badge new">New</span>}</h3>
                    <div className="meta">
                      {b.poster && <span>by {b.poster}</span>}
                      {b.reward && <span className="badge money">{b.reward}</span>}
                      {b.solvers !== undefined && <span>{b.solvers} joined</span>}
                      {b.spotsLeft !== undefined && <span>{b.spotsLeft} reward(s) left</span>}
                      <span className="muted">via {b.source}</span>
                    </div>
                    <p className="reasons">{b.reasons.join(" · ")}</p>
                  </div>
                  <a className="btn small" href={b.url} target="_blank" rel="noreferrer">Open</a>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      <section className="card how">
        <h2>How TinyFish powers this</h2>
        <ol>
          <li><span className="pill search">Search</span> queries each applicant-tracking system (Ashby, Greenhouse, Lever, Workday, Workable, YC) with a recency filter, so results are fresh postings at the source. A second Search in <b>news</b> mode finds companies that announced funding in the last 72 hours, then Search locates each one&apos;s careers board.</li>
          <li><span className="pill fetch">Fetch</span> reads every candidate posting at the source to confirm it&apos;s still open and extract location, salary, seniority and visa wording. It also reads funded companies&apos; job boards, Devpost&apos;s open-hackathon listing and Pond&apos;s bounty board.</li>
          <li><span className="pill agent">Agent</span> (deep mode) handles what Fetch can&apos;t: careers pages that render in the browser (e.g. Workable, custom sites) and bounty cards whose links only exist after a click.</li>
          <li>Results are deduplicated across sources, filtered (closed, wrong level, no sponsorship) and ranked by role fit, freshness, location, sponsorship and funding signal.</li>
        </ol>
      </section>
      <footer>Built for the TinyFish Student Bounty Drop 001 · Data is live; nothing is hardcoded.</footer>
    </main>
  );
}

function JobCard({ j, isNew }: { j: Job; isNew: boolean }) {
  return (
    <article className="item">
      <Score n={j.score} />
      <div className="body">
        <h3>
          <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>
          {isNew && <span className="badge new">New</span>}
        </h3>
        <div className="meta">
          <span className="company">{j.company}</span>
          {j.location && <span>📍 {j.location}</span>}
          {j.postedLabel && <span className={(j.postedHoursAgo ?? 99) <= 48 ? "fresh" : ""}>🕒 {j.postedLabel}</span>}
          {j.salary && <span className="badge money">{j.salary}</span>}
          {j.funding && <a className="badge funded" href={j.funding.url} target="_blank" rel="noreferrer" title={j.funding.headline}>💰 Just raised{j.funding.amount ? ` ${j.funding.amount}` : ""}</a>}
          {j.verified === "live" && <span className="badge live">✓ Live at source</span>}
          {j.visa === "sponsors" && <span className="badge live">Visa sponsorship mentioned</span>}
          {j.visa === "no-sponsor" && <span className="badge warn">No sponsorship</span>}
          <span className="muted">via {j.source}{j.alsoOn?.length ? ` · also on ${j.alsoOn.join(", ")}` : ""}</span>
        </div>
        {j.reasons.length > 0 && <p className="reasons">{j.reasons.join(" · ")}</p>}
      </div>
      <a className="btn small" href={j.url} target="_blank" rel="noreferrer">Apply</a>
    </article>
  );
}

function Score({ n }: { n: number }) {
  return <div className="score" style={{ ["--s" as string]: n }}><b>{n}</b><span>match</span></div>;
}

function Skeleton() {
  return <div className="skeleton">{[0, 1, 2].map((i) => <div key={i} />)}</div>;
}

function Empty({ text = "Nothing matched. Try a broader role, a longer time window, or clear the location." }: { text?: string }) {
  return <p className="empty">{text}</p>;
}
