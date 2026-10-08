// Browser-side helpers: local storage (profile + prefs never leave the browser
// except when the visitor runs a scan or an apply) and an SSE reader for POST streams.

export const store = {
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

export async function postStream<E>(url: string, body: unknown, onEvent: (e: E) => void, opts: { code?: string; signal?: AbortSignal } = {}): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": opts.code ?? "" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(err.error ?? `Request failed (${res.status})`), { status: res.status });
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
      if (line) onEvent(JSON.parse(line.slice(6)) as E);
    }
  }
}

const PALETTE = ["#ff5a1f", "#2160d8", "#0f8a6a", "#8b5cf6", "#d97706", "#db2777", "#0891b2", "#65a30d"];
export function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
