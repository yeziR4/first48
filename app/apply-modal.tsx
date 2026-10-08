"use client";

import { useRef, useState } from "react";
import type { ApplyEvent, ApplyResult, Job, Profile } from "@/lib/types";
import { postStream } from "./client";
import { Logo } from "./bits";

type Phase = "setup" | "running" | "done";

export function ApplyModal({ job, profile, code, onClose, onEditProfile }: {
  job: Job;
  profile: Profile;
  code: string;
  onClose: () => void;
  onEditProfile: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [submit, setSubmit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [fit, setFit] = useState<{ matched: string[]; missing: string[] } | null>(null);
  const [stream, setStream] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const ac = useRef<AbortController | null>(null);

  const ready = !!profile.name && !!profile.email;
  const missingBits = [!profile.name && "name", !profile.email && "email"].filter(Boolean);

  async function start() {
    setPhase("running");
    setError("");
    setSteps([]);
    setStream(null);
    setResult(null);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    ac.current = new AbortController();
    try {
      await postStream<ApplyEvent>("/api/apply", { url: job.url, title: job.title, company: job.company, profile, submit: submit && confirm, note }, (e) => {
        if (e.type === "status") setStatus(e.message);
        else if (e.type === "fit") setFit({ matched: e.matched, missing: e.missing });
        else if (e.type === "stream") setStream(e.url);
        else if (e.type === "progress") setSteps((s) => [...s, e.message]);
        else if (e.type === "result") setResult(e.result);
        else if (e.type === "error") setError(e.message);
      }, { code, signal: ac.current.signal });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      clearInterval(timer);
      setPhase("done");
    }
  }

  const verdict = result && {
    submitted: { cls: "good", text: "Application submitted 🎉" },
    filled_not_submitted: { cls: "info", text: "Form filled. Nothing was submitted." },
    blocked: { cls: "warn", text: "The agent hit something it couldn't do" },
    failed: { cls: "warn", text: "The agent didn't return a clear result" },
  }[result.status];

  return (
    <div className="overlay" onClick={() => phase !== "running" && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Logo src={job.logo} name={job.company} size={44} />
          <div className="grow">
            <div className="eyebrow">Auto-apply with TinyFish Agent</div>
            <h2>{job.title}</h2>
            <div className="muted small">{job.company}{job.location ? ` · ${job.location}` : ""}</div>
          </div>
          <button className="x" onClick={() => { ac.current?.abort(); onClose(); }} aria-label="Close">×</button>
        </div>

        {phase === "setup" && (
          <div className="modal-body">
            {!ready ? (
              <div className="callout">
                Add your {missingBits.join(" and ")} to your profile first. The agent fills forms only with what you give it.
                <button className="btn small" onClick={onEditProfile}>Open profile</button>
              </div>
            ) : (
              <div className="applicant">
                {profile.avatar ? <img src={profile.avatar} alt="" /> : <div className="mono">{profile.name![0]}</div>}
                <div className="grow">
                  <strong>{profile.name}</strong> <span className="muted small">{profile.email}</span>
                  <div className="chips small">{profile.skills.slice(0, 10).map((s) => <span key={s} className="tag static">{s}</span>)}</div>
                </div>
                <button className="btn ghost small" onClick={onEditProfile}>Edit</button>
              </div>
            )}

            <ol className="plan">
              <li><span className="pill fetch">Fetch</span> reads the posting and checks which of your skills it asks for.</li>
              <li><span className="pill agent">Agent</span> opens the application form and fills it from your profile. You watch it live.</li>
              <li>Answers are written only from your real profile. Demographic questions get &ldquo;decline to self-identify&rdquo;. If a required question needs something you didn&apos;t provide, it&apos;s left for you.</li>
            </ol>

            <label>Anything the agent should know? <span className="muted">(optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. available from November, open to relocation" />
            </label>

            <div className="modes">
              <label className={`mode ${!submit ? "on" : ""}`}>
                <input type="radio" checked={!submit} onChange={() => setSubmit(false)} />
                <div><strong>Fill only</strong><span className="muted small">Agent fills the form and stops before Submit. Good for a dry run.</span></div>
              </label>
              <label className={`mode ${submit ? "on" : ""}`}>
                <input type="radio" checked={submit} onChange={() => setSubmit(true)} />
                <div><strong>Fill &amp; submit</strong><span className="muted small">Agent submits the application for you.</span></div>
              </label>
            </div>
            {submit && (
              <label className="check warnbox">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                I&apos;ve checked my profile is accurate and I want TinyFish to submit this application in my name.
              </label>
            )}
            <p className="muted small">Takes 1–4 minutes. Uses paid TinyFish Agent credits.</p>
            <div className="row end">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={!ready || (submit && !confirm)} onClick={start}>{submit ? "Fill & submit →" : "Start filling →"}</button>
            </div>
          </div>
        )}

        {phase !== "setup" && (
          <div className="modal-body run">
            {fit && (
              <div className="fit">
                <span className="muted small">Posting asks for:</span>
                {fit.matched.map((s) => <span key={s} className="tag good">✓ {s}</span>)}
                {fit.missing.map((s) => <span key={s} className="tag dim">{s}</span>)}
                {!fit.matched.length && !fit.missing.length && <span className="muted small">no specific skills listed</span>}
              </div>
            )}
            <div className="live">
              <div className="live-bar">
                <span className={`rec ${phase === "running" ? "on" : ""}`} />
                {phase === "running" ? `Live: ${status}` : "Session ended"}
                <span className="muted"> · {elapsed}s</span>
              </div>
              {stream && phase === "running"
                ? <iframe src={stream} title="Live TinyFish browser" />
                : <div className="live-ph">{phase === "running" ? <><span className="spin" /> Starting a browser…</> : result ? "The live browser closes when the agent finishes. Here's what it did ↓" : "—"}</div>}
            </div>
            {steps.length > 0 && (
              <ol className="steps">
                {steps.map((s, i) => <li key={i} className={i === steps.length - 1 && phase === "running" ? "now" : ""}>{s}</li>)}
              </ol>
            )}
            {error && <p className="error">{error}</p>}
            {result && verdict && (
              <div className={`verdict ${verdict.cls}`}>
                <strong>{verdict.text}</strong>
                {result.summary && <p>{result.summary}</p>}
                {result.confirmation && <p className="small">Confirmation: &ldquo;{result.confirmation}&rdquo;</p>}
                {result.filled.length > 0 && (
                  <table>
                    <tbody>{result.filled.map((f, i) => <tr key={i}><td>{f.field}</td><td>{f.value}</td></tr>)}</tbody>
                  </table>
                )}
                {result.needsYou.length > 0 && (
                  <>
                    <p className="small"><strong>Needs you:</strong></p>
                    <ul className="small">{result.needsYou.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </>
                )}
                {result.status !== "submitted" && <a className="btn small" href={job.url} target="_blank" rel="noreferrer">Open the posting to finish →</a>}
              </div>
            )}
            {phase === "running" && <div className="row end"><button className="btn ghost small" onClick={() => ac.current?.abort()}>Stop agent</button></div>}
          </div>
        )}
      </div>
    </div>
  );
}
