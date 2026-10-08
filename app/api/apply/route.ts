import { apply, type ApplyRequest } from "@/lib/apply";
import { guard, sse } from "@/lib/guard";
import type { ApplyEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const blocked = guard(req, "apply", 6);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => null)) as ApplyRequest | null;
  if (!body?.url || !/^https:\/\//.test(body.url)) return Response.json({ error: "Missing job URL." }, { status: 400 });
  if (!body.profile?.name || !body.profile?.email) return Response.json({ error: "Your profile needs at least a name and email." }, { status: 400 });
  body.profile.skills ??= [];
  body.profile.projects ??= [];
  body.profile.links ??= {};
  return sse<ApplyEvent>((emit, signal) => apply({ ...body, submit: body.submit === true }, emit, signal));
}
