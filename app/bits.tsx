"use client";

import { useState } from "react";
import { colorFor } from "./client";

/** Company logo pulled from the posting by TinyFish Fetch; falls back to a coloured monogram. */
export function Logo({ src, name, size = 48 }: { src?: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const letters = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  if (src && !broken) {
    return (
      <div className="logo" style={{ width: size, height: size }}>
        <img src={src} alt={`${name} logo`} onError={() => setBroken(true)} loading="lazy" referrerPolicy="no-referrer" />
      </div>
    );
  }
  return <div className="logo mono" style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.36 }}>{letters}</div>;
}

export function ScoreRing({ n }: { n: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" title={`${n}/100 match`}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        <circle cx="20" cy="20" r={r} className="ring-bg" />
        <circle cx="20" cy="20" r={r} className="ring-fg" strokeDasharray={`${(n / 100) * c} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
      <b>{n}</b>
    </div>
  );
}
