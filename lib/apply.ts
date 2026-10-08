// Auto-apply: Fetch reads the posting for a fit check, then the TinyFish Agent opens the
// application form and fills it from the candidate's profile while the UI shows the live browser.
// By default it stops before submitting; it only submits when the user explicitly asks.
import { findSkills } from "./profile";
import { agentJson, agentStream, TinyFish } from "./tinyfish";
import type { ApplyEvent, ApplyResult, Profile } from "./types";

export interface ApplyRequest {
  url: string;
  title?: string;
  company?: string;
  profile: Profile;
  submit: boolean;
  note?: string; // anything the candidate wants included (e.g. notice period)
}

function candidateCard(p: Profile): string {
  const lines = [
    `Full name: ${p.name ?? ""}`,
    `Email: ${p.email ?? ""}`,
    `Phone: ${p.phone || "NOT PROVIDED"}`,
    p.location && `Current location: ${p.location}`,
    `Work authorization: ${p.workAuth || "NOT PROVIDED"}`,
    p.headline && `Headline: ${p.headline}`,
    p.links.linkedin && `LinkedIn: ${p.links.linkedin}`,
    p.links.github && `GitHub: ${p.links.github}`,
    p.links.portfolio && `Portfolio/website: ${p.links.portfolio}`,
    p.links.x && `X/Twitter: ${p.links.x}`,
    p.resumeUrl && `Resume link: ${p.resumeUrl}`,
    p.skills.length && `Skills: ${p.skills.join(", ")}`,
    p.projects.length && `Projects: ${p.projects.map((x) => `${x.name}${x.description ? ` (${x.description})` : ""}${x.url ? ` ${x.url}` : ""}`).join("; ")}`,
    p.bio && `About: ${p.bio}`,
  ].filter(Boolean);
  if (p.resumeText) lines.push(`Resume text:\n${p.resumeText.slice(0, 4000)}`);
  return lines.join("\n");
}

function goal(req: ApplyRequest): string {
  const stop = req.submit
    ? `If ANY required field is still empty, do NOT submit; return status "blocked" and list what is missing. Otherwise click the final Submit button ONCE and wait for the confirmation message.`
    : `IMPORTANT: Do NOT click the final Submit/Send application button. Stop once the form is filled so the candidate can review it.`;
  return [
    `You are helping a job seeker apply to "${req.title ?? "this job"}"${req.company ? ` at ${req.company}` : ""}.`,
    `Work efficiently: read the form once, then fill fields directly without re-checking each one. Close any cookie banner. If this is the job description page, click "Apply" / "Apply for this job" to open the application form.`,
    `Fill in the application form using ONLY the candidate information below. Never invent experience, employers, degrees or numbers, and NEVER make up contact details (phone, address, etc.). If a value is "NOT PROVIDED" or missing, leave that field empty and list it under needs_you.`,
    `- For short free-text questions (e.g. "Why do you want to work here?"), write 2–4 honest sentences that connect the candidate's real skills and projects to this role.`,
    `- For voluntary demographic / EEO questions, choose "Decline to self-identify" or the closest equivalent.`,
    `- For the resume: if there is an option to paste text or "enter manually", paste the resume text (or a short summary of the candidate info). If only a file upload is accepted and it is required, leave it and list it under needs_you.`,
    `- Eligibility and legal questions (right to work, visa/sponsorship, prior employment at this company, conflicts of interest, criminal history, etc.): answer ONLY if the candidate information states it explicitly; otherwise leave them and list them under needs_you. Never guess.`,
    `- Do not use the candidate's location as a street address. Leave address fields empty unless an address is given.`,
    req.submit
      ? `- Consent checkboxes (privacy policy, data processing): the candidate has authorized submission, so you may accept standard privacy/data-processing consents required to submit.`
      : `- Do NOT tick consent or agreement checkboxes; list them under needs_you.`,
    `- If a required question cannot be answered from the candidate information, leave it empty and list it under needs_you.`,
    req.note ? `- Extra note from the candidate: ${req.note}` : "",
    stop,
    `Finally return ONLY JSON: {"status":"submitted"|"filled_not_submitted"|"blocked","filled":[{"field":"...","value":"..."}],"needs_you":["..."],"confirmation":"text shown after submitting, if any","summary":"one sentence"}`,
    `\nCANDIDATE INFORMATION\n${candidateCard(req.profile)}`,
  ].filter(Boolean).join("\n");
}

export async function apply(req: ApplyRequest, emit: (e: ApplyEvent) => void, signal?: AbortSignal): Promise<void> {
  const tf = new TinyFish();

  // 1. Fit check with Fetch (free): which of the candidate's skills does the posting ask for?
  emit({ type: "status", message: "Reading the posting to check your fit…" });
  const page = (await tf.fetch([req.url], "Read posting for fit check", { purpose: "Extract the job's required skills" })).get(req.url);
  const wanted = findSkills(page?.text ?? "");
  const have = new Set(req.profile.skills.map((s) => s.toLowerCase()));
  emit({
    type: "fit",
    matched: wanted.filter((s) => have.has(s)),
    missing: wanted.filter((s) => !have.has(s)).slice(0, 10),
    title: req.title ?? page?.title,
    company: req.company,
  });

  // 2. Agent fills (and optionally submits) the form, streaming the live browser.
  emit({ type: "status", message: req.submit ? "Agent is filling and submitting the application…" : "Agent is filling the application (it will stop before submitting)…" });
  const final = await agentStream(
    { url: req.url, goal: goal(req), browser_profile: "stealth", agent_config: { max_duration_seconds: 200 } },
    (e) => {
      if (e.type === "STREAMING_URL" && e.streaming_url) emit({ type: "stream", url: e.streaming_url });
      else if (e.type === "PROGRESS" && e.purpose) emit({ type: "progress", message: e.purpose });
    },
    signal,
  );

  if (!final || final.status !== "COMPLETED") {
    emit({ type: "error", message: `The agent couldn't finish: ${final?.error ?? final?.status ?? "no result"}` });
    return;
  }
  const raw = agentJson<{ status?: string; filled?: { field: string; value: string }[]; needs_you?: string[]; confirmation?: string; summary?: string }>(final.result);
  const status = (["submitted", "filled_not_submitted", "blocked"].includes(raw?.status ?? "") ? raw!.status : "failed") as ApplyResult["status"];
  emit({
    type: "result",
    result: {
      status: !req.submit && status === "submitted" ? "filled_not_submitted" : status,
      filled: (raw?.filled ?? []).slice(0, 40),
      needsYou: raw?.needs_you ?? [],
      confirmation: raw?.confirmation,
      summary: raw?.summary ?? (typeof final.result === "object" && final.result && "result" in final.result ? String((final.result as { result: unknown }).result).slice(0, 400) : undefined),
    },
  });
}
