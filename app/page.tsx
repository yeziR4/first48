"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Bounty, CallLog, Endpoint, Hackathon, Job, Profile, ScanEvent, Stats } from "@/lib/types";
import { ApplyModal } from "./apply-modal";
import { Logo, ScoreRing } from "./bits";
import { postStream, store } from "./client";
import { EMPTY_PROFILE, ProfilePanel } from "./profile-panel";

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

const EXAMPLES = [
  { roles: "software engineer", location: "Remote" },
  { roles: "data scientist", location: "London" },
  { roles: "product designer", location: "New York" },
  { roles: "machine learning engineer", location: "" },
];

export default function Home() {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [showProfile, setShowProfile] = useState(false);
  const [applyTo, setApplyTo] = useState<Job | null>(null);
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
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setForm(store.get("f48:form", DEFAULT_FORM));
    setProfile({ ...EMPTY_PROFILE, ...store.get<Profile>("f48:profile", EMPTY_PROFILE) });
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
  const saveProfile = (p: Profile) => { setProfile(p); store.set("f48:profile", p); };
  const hasProfile = profile.skills.length > 0 || !!profile.name;

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
    setTab(form.lanes.jobs ? "jobs" : form.lanes.hackathons ? "hackathons" : "bounties");
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    const ac = new AbortController();
    abortRef.current = ac;
    const allIds: string[] = [];

    try {
      await postStream<ScanEvent>("/api/scan", { ...form, roles: form.roles.split(","), keywords: form.keywords.split(","), skills: profile.skills }, (e) => {
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
      }, { code, signal: ac.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedCode(true);
      if ((e as Error).name !== "AbortError") setErrors((x) => [...x, (e as Error).message]);
      setStatus("");
    } finally {
      setRunning(false);
      // Remember what this visitor has seen so the next scan can flag what's new.
      store.set("f48:seen", [...new Set([...store.get<string[]>("f48:seen", []), ...allIds])].slice(-3000));
    }
  }

  const shownJobs = useMemo(
    () => (jobs ?? []).filter((j) => (!onlyLive || j.verified === "live") && (!onlyFunded || j.funding)),
    [jobs, onlyLive, onlyFunded],
  );
  const isNew = (id: string) => seen.size > 0 && !seen.has(id);
  const newCount = (jobs ?? []).filter((j) => isNew(j.id)).length;

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
    <>
      <div className="bg-glow" aria-hidden />
      <header className="topbar">
        <div className="brand"><span className="dot" /> First 48</div>
        <button className="profile-btn" onClick={() => setShowProfile(true)}>
          {profile.avatar ? <img src={profile.avatar} alt="" /> : <span className="mono sm">{(profile.name || "+")[0]}</span>}
          <span>{hasProfile ? (profile.name?.split(" ")[0] || "Profile") : "Add your profile"}</span>
          {profile.skills.length > 0 && <span className="count">{profile.skills.length} skills</span>}
        </button>
      </header>

      <main>
        <section className="hero">
          <div className="kicker"><span className="live-dot" /> Live from company careers pages</div>
          <h1>Be early,<br />not applicant <span className="strike">#900</span>.</h1>
          <p className="sub">
            First 48 finds roles, hackathons and bounties that opened in the last day or two, checks each one is live at the source,
            ranks them by your skills, and can fill in the application for you.
          </p>
          <div className="lanes-preview">
            <div><b>Jobs</b><span>Ashby · Greenhouse · Lever · Workday · Workable · YC</span></div>
            <div><b>Just funded</b><span>companies that raised this week, hiring next</span></div>
            <div><b>Hackathons</b><span>Devpost · Luma · Eventbrite</span></div>
            <div><b>Bounties</b><span>paid company tasks on Pond</span></div>
          </div>
        </section>

        <section className="card search">
          <div className="grid">
            <label>Role(s)<input value={form.roles} onChange={(e) => set("roles", e.target.value)} placeholder="software engineer, data scientist" /></label>
            <label>Location<input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Remote, London… (blank = anywhere)" /></label>
            <label>Keywords<input value={form.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="optional: python, llm, fintech" /></label>
            <label>Seniority
              <select value={form.seniority} onChange={(e) => set("seniority", e.target.value)}>
                <option value="any">Any level</option><option value="intern">Internship</option><option value="entry">Entry / new grad</option>
                <option value="mid">Mid</option><option value="senior">Senior+</option>
              </select>
            </label>
            <label>Posted within
              <select value={form.freshnessHours} onChange={(e) => set("freshnessHours", Number(e.target.value))}>
                <option value={24}>Last 24 hours</option><option value={48}>Last 48 hours</option><option value={168}>Last 7 days</option>
              </select>
            </label>
            <div className="toggles">
              <label className="switch"><input type="checkbox" checked={form.needsVisa} onChange={(e) => set("needsVisa", e.target.checked)} /><span /> I need visa sponsorship</label>
              <label className="switch"><input type="checkbox" checked={form.deep} onChange={(e) => set("deep", e.target.checked)} /><span /> Deep mode <em className="muted">Agent reads tricky pages, +1–3 min</em></label>
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
            <div className="row-right">
              {needCode && <input className="code" value={code} placeholder="Access code" onChange={(e) => { setCode(e.target.value); store.set("f48:code", e.target.value); }} />}
              {running
                ? <button className="btn ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
                : <button className="btn big" onClick={run} disabled={!form.roles.trim()}>Scan the live web →</button>}
            </div>
          </div>
          <div className="examples">
            <span className="muted small">Try:</span>
            {EXAMPLES.map((x) => (
              <button key={x.roles} className="link small" onClick={() => setForm((f) => ({ ...f, roles: x.roles, location: x.location }))}>
                {x.roles}{x.location ? ` · ${x.location}` : ""}
              </button>
            ))}
          </div>
          {!hasProfile && (
            <button className="profile-nudge" onClick={() => setShowProfile(true)}>
              <span>🔗</span>
              <div><strong>Add your GitHub, LinkedIn or portfolio</strong><span className="muted small">We&apos;ll read your skills to rank jobs for you, and unlock one-click auto-apply.</span></div>
              <span className="arrow">→</span>
            </button>
          )}
        </section>

        {started && (
          <section className="card activity" ref={resultsRef}>
            <div className="activity-head">
              <div className="status-line">
                {running ? <span className="spin" /> : <span className="ok-dot" />}
                <strong>{running ? status : status || "Finished"}</strong>
                {running && <span className="muted"> · {elapsed}s</span>}
              </div>
              <div className="counters">
                <span className="pill search">Search × {calls.search}</span>
                <span className="pill fetch">Fetch × {calls.fetch}</span>
                <span className="pill agent">Agent × {calls.agent}</span>
              </div>
            </div>
            {running && <div className="progress"><div /></div>}
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
              <button className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")}>Jobs <span>{jobs ? jobs.length : "…"}</span></button>
              <button className={tab === "hackathons" ? "on" : ""} onClick={() => setTab("hackathons")}>Hackathons <span>{hacks ? hacks.length : "…"}</span></button>
              <button className={tab === "bounties" ? "on" : ""} onClick={() => setTab("bounties")}>Bounties <span>{bounties ? bounties.length : "…"}</span></button>
            </nav>

            {tab === "jobs" && (
              <section>
                {stats && (
                  <div className="funnel">
                    <div><b>{stats.candidates}</b><span>found</span></div>
                    <div><b>{stats.duplicatesMerged}</b><span>duplicates merged</span></div>
                    <div><b>{stats.closedRemoved}</b><span>closed removed</span></div>
                    {stats.visaFiltered > 0 && <div><b>{stats.visaFiltered}</b><span>no sponsorship</span></div>}
                    {stats.seniorityFiltered > 0 && <div><b>{stats.seniorityFiltered}</b><span>wrong level</span></div>}
                    <div className="final"><b>{jobs?.length ?? 0}</b><span>ranked for you</span></div>
                    <div className="funded-stat"><b>{stats.fundedCompanies}</b><span>companies just raised</span></div>
                  </div>
                )}
                {pending.jobs && <p className="pending"><span className="spin" /> {pending.jobs}</p>}
                {jobs && jobs.length > 0 && (
                  <div className="toolbar">
                    <label className="chip-toggle"><input type="checkbox" checked={onlyLive} onChange={(e) => setOnlyLive(e.target.checked)} /> ✓ Verified live</label>
                    <label className="chip-toggle"><input type="checkbox" checked={onlyFunded} onChange={(e) => setOnlyFunded(e.target.checked)} /> 💰 Just funded</label>
                    {newCount > 0 && <span className="badge new">{newCount} new since last scan</span>}
                    <button className="btn ghost small" onClick={exportCsv}>Export CSV</button>
                  </div>
                )}
                {jobs === null ? <Skeleton /> : shownJobs.length === 0 ? <Empty /> : (
                  <div className="list">
                    {shownJobs.map((j, i) => <JobCard key={j.id} j={j} i={i} isNew={isNew(j.id)} onAutoApply={() => setApplyTo(j)} />)}
                  </div>
                )}
              </section>
            )}

            {tab === "hackathons" && (
              <section>
                {hacks === null ? <Skeleton /> : hacks.length === 0 ? <Empty /> : (
                  <div className="hack-grid">
                    {hacks.map((h, i) => (
                      <a key={h.id} className="hack" href={h.url} target="_blank" rel="noreferrer" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                        <div className="hack-img">
                          {h.image ? <img src={h.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Logo name={h.title} size={64} />}
                          {h.prize && <span className="prize">{h.prize}</span>}
                          {isNew(h.id) && <span className="badge new corner">New</span>}
                        </div>
                        <div className="hack-body">
                          <h3>{h.title}</h3>
                          <div className="meta">
                            {h.dates && <span>📅 {h.dates}</span>}
                            <span>{h.online ? "🌍 Online" : `📍 ${h.location || "In person"}`}</span>
                          </div>
                          <p className="reasons">{h.host ? `${h.host} · ` : ""}via {h.source}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === "bounties" && (
              <section>
                {pending.bounties && <p className="pending"><span className="spin" /> {pending.bounties}</p>}
                {bounties === null ? <Skeleton /> : bounties.length === 0 ? <Empty text="No open bounties on the tracked boards right now." /> : (
                  <div className="list">
                    {bounties.map((b, i) => (
                      <article key={b.id} className="item" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                        <Logo name={b.poster ?? b.title} />
                        <div className="body">
                          <h3><a href={b.url} target="_blank" rel="noreferrer">{b.title}</a>{isNew(b.id) && <span className="badge new">New</span>}</h3>
                          <div className="meta">
                            {b.poster && <span className="company">{b.poster}</span>}
                            {b.solvers !== undefined && <span>👥 {b.solvers} joined</span>}
                            {b.spotsLeft !== undefined && <span>{b.spotsLeft} reward(s) left</span>}
                            <span className="muted">via {b.source}</span>
                          </div>
                          <p className="reasons">{b.reasons.join(" · ")}</p>
                        </div>
                        <div className="side">
                          {b.reward && <span className="reward">{b.reward}</span>}
                          <a className="btn small" href={b.url} target="_blank" rel="noreferrer">Open</a>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        <section className="how">
          <h2>How TinyFish powers this</h2>
          <div className="how-grid">
            <div><span className="pill search">Search</span><p>Queries each company job-board system with a recency filter for fresh postings. In news mode it finds companies that raised money in the last 72 hours, then locates their careers boards.</p></div>
            <div><span className="pill fetch">Fetch</span><p>Opens every posting at the source to confirm it&apos;s live and pull location, salary, visa wording and the company logo. Reads your GitHub, LinkedIn and portfolio to build your skills profile, plus Devpost&apos;s and Pond&apos;s listings.</p></div>
            <div><span className="pill agent">Agent</span><p>Fills in applications from your profile while you watch the live browser. In deep mode it also reads careers pages and bounty cards that only work in a real browser.</p></div>
          </div>
        </section>
        <footer>Built for the TinyFish Student Bounty Drop 001 · Every result is live web data; nothing is hardcoded.</footer>
      </main>

      {showProfile && <ProfilePanel profile={profile} code={code} onChange={saveProfile} onClose={() => setShowProfile(false)} />}
      {applyTo && (
        <ApplyModal job={applyTo} profile={profile} code={code} onClose={() => setApplyTo(null)} onEditProfile={() => setShowProfile(true)} />
      )}
    </>
  );
}

function JobCard({ j, i, isNew, onAutoApply }: { j: Job; i: number; isNew: boolean; onAutoApply: () => void }) {
  return (
    <article className="item" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
      <Logo src={j.logo} name={j.company} />
      <div className="body">
        <h3>
          <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>
          {isNew && <span className="badge new">New</span>}
        </h3>
        <div className="meta">
          <span className="company">{j.company}</span>
          {j.location && <span>📍 {j.location.length > 60 ? j.location.slice(0, 57) + "…" : j.location}</span>}
          {j.postedLabel && <span className={(j.postedHoursAgo ?? 99) <= 48 ? "fresh" : ""}>🕒 {j.postedLabel}</span>}
        </div>
        <div className="badges">
          {j.verified === "live" && <span className="badge live">✓ Live at source</span>}
          {j.funding && <a className="badge funded" href={j.funding.url} target="_blank" rel="noreferrer" title={j.funding.headline}>💰 Just raised{j.funding.amount ? ` ${j.funding.amount}` : ""}</a>}
          {j.salary && <span className="badge money">{j.salary}</span>}
          {j.visa === "sponsors" && <span className="badge live">Visa sponsorship</span>}
          {j.visa === "no-sponsor" && <span className="badge warn">No sponsorship</span>}
          {j.skillHits?.slice(0, 5).map((s) => <span key={s} className="badge skill">{s}</span>)}
          <span className="via">via {j.source}{j.alsoOn?.length ? ` · also on ${j.alsoOn.join(", ")}` : ""}</span>
        </div>
        {j.reasons.length > 0 && <p className="reasons">{j.reasons.join(" · ")}</p>}
      </div>
      <div className="side">
        <ScoreRing n={j.score} />
        <a className="btn small" href={j.url} target="_blank" rel="noreferrer">Apply</a>
        <button className="btn ghost small agent-btn" onClick={onAutoApply}>⚡ Auto-apply</button>
      </div>
    </article>
  );
}

function Skeleton() {
  return <div className="skeleton">{[0, 1, 2, 3].map((i) => <div key={i} />)}</div>;
}

function Empty({ text = "Nothing matched. Try a broader role, a longer time window, or clear the location." }: { text?: string }) {
  return <p className="empty">{text}</p>;
}
