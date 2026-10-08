// Shared access-code check and per-IP rate limit for the demo deployment.
const hits = new Map<string, number[]>();

export function guard(req: Request, bucket: string, perHour: number): Response | null {
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return Response.json({ error: "Wrong or missing access code." }, { status: 401 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const k = `${bucket}:${ip}`;
  const recent = (hits.get(k) ?? []).filter((t) => t > Date.now() - 3_600_000);
  if (recent.length >= perHour) return Response.json({ error: `Rate limit: ${perHour} per hour.` }, { status: 429 });
  hits.set(k, [...recent, Date.now()]);
  return null;
}

export function sse<T>(run: (emit: (e: T) => void, signal: AbortSignal) => Promise<void>): Response {
  const enc = new TextEncoder();
  const ac = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (e: T) => open && controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => open && controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      try {
        await run(emit, ac.signal);
      } catch (e) {
        emit({ type: "error", message: (e as Error).message } as T);
      } finally {
        clearInterval(ping);
        open = false;
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
