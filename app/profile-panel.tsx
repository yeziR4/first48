"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";

export const EMPTY_PROFILE: Profile = { links: {}, skills: [], projects: [], sources: [] };

export function ProfilePanel({ profile, onChange, onClose, code }: {
  profile: Profile;
  onChange: (p: Profile) => void;
  onClose: () => void;
  code: string;
}) {
  const [p, setP] = useState<Profile>(profile);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [skillDraft, setSkillDraft] = useState("");

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const setLink = (k: keyof Profile["links"], v: string) => setP((x) => ({ ...x, links: { ...x.links, [k]: v } }));

  async function readLinks() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": code },
        body: JSON.stringify(p),
      });
      const d = (await r.json()) as Profile & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Couldn't read links");
      // Keep anything the person typed themselves over what we extracted.
      const merged: Profile = {
        ...d,
        name: p.name || d.name,
        headline: p.headline || d.headline,
        email: p.email, phone: p.phone, location: p.location || d.location, workAuth: p.workAuth,
        resumeText: p.resumeText, resumeUrl: p.resumeUrl,
      };
      setP(merged);
      onChange(merged);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    onChange(p);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Your profile</h2>
            <p className="muted small">Used to rank jobs by your skills and to auto-apply. Stored only in this browser.</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {(p.avatar || p.name || p.skills.length > 0) && (
          <div className="me">
            {p.avatar ? <img src={p.avatar} alt="" /> : <div className="mono big">{(p.name ?? "?")[0]}</div>}
            <div>
              <strong>{p.name || "Your name"}</strong>
              {p.headline && <div className="muted small">{p.headline}</div>}
              {p.bio && p.bio.toLowerCase().replace(/\W/g, "") !== (p.headline ?? "").toLowerCase().replace(/\W/g, "").slice(0, p.bio.replace(/\W/g, "").length) && <div className="small">{p.bio}</div>}
            </div>
          </div>
        )}

        <h3>Links</h3>
        <p className="muted small">TinyFish Fetch reads these to pull out your skills and projects.</p>
        <div className="grid2">
          <label>GitHub<input value={p.links.github ?? ""} onChange={(e) => setLink("github", e.target.value)} placeholder="github.com/you" /></label>
          <label>LinkedIn<input value={p.links.linkedin ?? ""} onChange={(e) => setLink("linkedin", e.target.value)} placeholder="linkedin.com/in/you" /></label>
          <label>Portfolio / website<input value={p.links.portfolio ?? ""} onChange={(e) => setLink("portfolio", e.target.value)} placeholder="you.dev" /></label>
          <label>X<input value={p.links.x ?? ""} onChange={(e) => setLink("x", e.target.value)} placeholder="@you" /></label>
        </div>
        <button className="btn ghost" onClick={readLinks} disabled={busy || !Object.values(p.links).some(Boolean)}>
          {busy ? <><span className="spin" /> Reading your links…</> : "✨ Read my links"}
        </button>
        {err && <p className="error">{err}</p>}
        {p.sources.length > 0 && (
          <ul className="sources">
            {p.sources.map((s) => <li key={s.url} className={s.ok ? "ok" : "warn"}>{s.ok ? "✓" : "!"} {s.url.replace(/^https?:\/\/(www\.)?/, "")}{s.note && <span className="muted"> — {s.note}</span>}</li>)}
          </ul>
        )}

        <h3>Skills</h3>
        <div className="chips">
          {p.skills.map((s) => (
            <button key={s} className="tag" onClick={() => set("skills", p.skills.filter((x) => x !== s))} title="Remove">{s} ×</button>
          ))}
          <input
            className="tag-input"
            value={skillDraft}
            placeholder="+ add skill"
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && skillDraft.trim()) {
                set("skills", [...new Set([...p.skills, skillDraft.trim().toLowerCase()])]);
                setSkillDraft("");
              }
            }}
          />
        </div>
        {p.projects.length > 0 && (
          <>
            <h3>Projects found</h3>
            <ul className="projects">
              {p.projects.map((x) => <li key={x.name}><a href={x.url} target="_blank" rel="noreferrer">{x.name}</a>{x.description && <span className="muted"> — {x.description}</span>}</li>)}
            </ul>
          </>
        )}

        <h3>For applications</h3>
        <div className="grid2">
          <label>Full name<input value={p.name ?? ""} onChange={(e) => set("name", e.target.value)} /></label>
          <label>Email<input type="email" value={p.email ?? ""} onChange={(e) => set("email", e.target.value)} /></label>
          <label>Phone <span className="muted">(optional)</span><input value={p.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></label>
          <label>Location<input value={p.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Lagos, Nigeria" /></label>
          <label>Work authorization
            <select value={p.workAuth ?? ""} onChange={(e) => set("workAuth", e.target.value)}>
              <option value="">—</option>
              <option>Authorized to work, no sponsorship needed</option>
              <option>Will need visa sponsorship</option>
              <option>Open to remote / contractor only</option>
            </select>
          </label>
          <label>Résumé link <span className="muted">(optional)</span><input value={p.resumeUrl ?? ""} onChange={(e) => set("resumeUrl", e.target.value)} placeholder="Google Drive / PDF link" /></label>
        </div>
        <label>Résumé text <span className="muted">(pasted into forms that allow it)</span>
          <textarea rows={5} value={p.resumeText ?? ""} onChange={(e) => set("resumeText", e.target.value)} placeholder="Paste your résumé as plain text" />
        </label>

        <div className="drawer-foot">
          <button className="btn ghost" onClick={() => { setP({ ...p, ...{ links: {}, skills: [], projects: [], sources: [] }, name: "", email: "", phone: "", location: "", headline: "", bio: "", avatar: undefined, resumeText: "", resumeUrl: "" }); }}>Clear</button>
          <button className="btn" onClick={save}>Save profile</button>
        </div>
      </aside>
    </div>
  );
}
