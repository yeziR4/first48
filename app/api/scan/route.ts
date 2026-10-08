import { parsePrefs, scan } from "@/lib/scan";
import type { ScanEvent } from "@/lib/types";
import { guard, sse } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const blocked = guard(req, "scan", 12);
  if (blocked) return blocked;
  const prefs = parsePrefs(await req.json().catch(() => ({})));
  if (!prefs.roles.length) return Response.json({ error: "Add at least one role." }, { status: 400 });

  return sse<ScanEvent>((emit) => scan(prefs, emit));
}
