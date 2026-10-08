import { guard } from "@/lib/guard";
import { buildProfile } from "@/lib/profile";
import { TinyFish } from "@/lib/tinyfish";
import type { Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = guard(req, "profile", 20);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Partial<Profile>;
  const links = body.links ?? {};
  if (!Object.values(links).some(Boolean)) return Response.json({ error: "Add at least one link." }, { status: 400 });
  const profile = await buildProfile(new TinyFish(), body);
  return Response.json(profile);
}
