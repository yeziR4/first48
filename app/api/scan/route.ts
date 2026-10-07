import { parsePrefs, scan } from "@/lib/scan";
import type { ScanEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Light abuse guard for the demo deployment: one scan per IP at a time, max 10/hour.
const recent = new Map<string, number[]>();
const running = new Set<string>();

export async function POST(req: Request) {
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return Response.json({ error: "Wrong or missing access code." }, { status: 401 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const hour = Date.now() - 3_600_000;
  const hits = (recent.get(ip) ?? []).filter((t) => t > hour);
  if (running.has(ip)) return Response.json({ error: "A scan is already running for you." }, { status: 429 });
  if (hits.length >= 10) return Response.json({ error: "Rate limit: 10 scans per hour." }, { status: 429 });
  recent.set(ip, [...hits, Date.now()]);

  const prefs = parsePrefs(await req.json().catch(() => ({})));
  if (!prefs.roles.length) return Response.json({ error: "Add at least one role." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      running.add(ip);
      let open = true;
      const emit = (e: ScanEvent) => {
        if (open) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      // Keep proxies from closing the connection during long Agent runs.
      const ping = setInterval(() => open && controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      try {
        await scan(prefs, emit);
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
      } finally {
        clearInterval(ping);
        running.delete(ip);
        open = false;
        controller.close();
      }
    },
    cancel() {
      running.delete(ip);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
