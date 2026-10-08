# First 48

**Be early, not applicant #900.** First 48 finds jobs, hackathons and bounties that opened in the last day or two, straight from the source. It checks every listing is still live, removes duplicates, and ranks the results against what you're looking for.

Built for the TinyFish Student Bounty Drop 001 (Job Portal / Careers Finder).

## What it does

You set your **roles, location, keywords, seniority, how fresh** results must be, and whether you **need visa sponsorship**. First 48 then:

1. **Finds fresh postings at the source.** It searches company applicant-tracking systems directly (Ashby, Greenhouse, Lever, Workday, Workable, YC Work at a Startup) with a recency filter. You get the company's own posting, not a reposted copy on an aggregator.
2. **Flags companies that just raised money.** It reads funding news from the last 72 hours, finds each company's careers board, and pulls its open roles. Freshly funded companies are about to hire, often before the roles reach LinkedIn.
3. **Verifies every posting.** It opens each posting to confirm it's still open, then extracts location, salary, seniority and visa wording ("unable to sponsor" or "visa sponsorship available").
4. **Deduplicates, filters and ranks** by role fit, freshness, location, seniority, sponsorship and the funding signal. Each step shows its numbers: *57 postings found → 1 duplicate merged → 1 closed listing removed → 48 ranked for you.*
5. **Adds two more lanes:**
   - **hackathons**: Devpost's open and upcoming list, plus Luma and Eventbrite events
   - **bounties**: paid tasks companies post on marketplaces like [Pond](https://joinpond.ai/tasks)
6. **Builds your profile from your links.** Paste your GitHub, LinkedIn, portfolio or X. TinyFish Fetch reads them and pulls out your skills, projects and headline. Jobs are then ranked by how many of *your* skills each posting asks for.
7. **Auto-applies with TinyFish Agent, while you watch.** Click ⚡ Auto-apply on any job:
   - Fetch checks your fit first.
   - The Agent opens the application form and fills it from your profile, shown in a live browser preview.
   - **Fill only** (the default) stops before submitting. **Fill & submit** requires an explicit confirmation.
   - The Agent never invents anything. Phone numbers, addresses, work authorization, eligibility questions and consent boxes come only from what you provided. Anything missing is returned to you as a "Needs you" list.
8. **Marks what's new since your last visit**, so a second scan shows only what changed. Results export to CSV.

## How TinyFish is used

| Endpoint | What it does here |
|---|---|
| **Search** | Searches each applicant-tracking system's domain (`include_domains`) with `recency_minutes` to find fresh postings. **News mode** (`domain_type=news`) finds companies that just raised money. Further searches locate each funded company's job board and resolve direct links to bounty tasks. |
| **Fetch** | Reads every candidate posting at the source to verify it's live and extract details. Also reads funded companies' job boards (`links: true`), Devpost's open-hackathon listing, Luma and Eventbrite event pages, and Pond's bounty board. |
| **Agent (auto-apply)** | Uses `run-sse`. The `STREAMING_URL` event is embedded as a live browser view, and `PROGRESS` events become a step list. The Agent fills the application from the visitor's profile and returns what it filled plus what it needs from the visitor. |
| **Agent** | In **deep mode**, Agent reads what Fetch can't: careers pages that render in the browser (Workable, custom company sites) and bounty cards whose links only exist after a click. It costs credits, so it's limited to a few runs per scan, and its results stream in after the fast results. |

Company logos come from the job posting itself: Fetch's `image_links` returns the employer logo that Ashby, Lever, Greenhouse and YC pages embed. Hackathon artwork comes from Devpost's listing and the event pages.

Every TinyFish call is listed live in the UI's call log, with a running count per endpoint.

## Run it

```bash
npm install
cp .env.example .env.local   # then put your key in TINYFISH_API_KEY
npm run dev                  # http://localhost:3000
```

To test the pipeline from the command line without the UI:

```bash
TINYFISH_API_KEY=... npm run scan -- --roles "data scientist" --location remote --visa --fresh 168 --deep
```

### Deploy (Vercel)

1. Import the repo in Vercel.
2. Add the environment variable `TINYFISH_API_KEY`.
3. Optional: add `ACCESS_CODE` so only people with the code can run scans.

The scan route streams results with server-sent events and sets `maxDuration = 300` seconds.

## Project layout

```
app/page.tsx               UI: preferences, live call log, ranked results
app/api/scan/route.ts      Streaming scan endpoint (SSE)
app/api/profile/route.ts   Build a profile from GitHub / LinkedIn / portfolio links (Fetch)
app/api/apply/route.ts     Auto-apply stream: fit check (Fetch) + form filling (Agent, live preview)
lib/apply.ts               Agent instructions and safety rules for applications
lib/profile.ts             Profile extraction + skills dictionary
lib/guard.ts               Access code, rate limits, SSE helper
lib/tinyfish.ts            Search / Fetch / Agent client with caching and call logging
lib/sources/jobs.ts        ATS search, funding signal, verification, Agent fallback
lib/sources/hackathons.ts  Devpost listing + Luma/Eventbrite events
lib/sources/bounties.ts    Bounty marketplaces (Pond; add more in BOUNTY_SOURCES)
lib/rank.ts                Dedup, filters, scoring
scripts/scan.ts            CLI runner
```

## Limitations

- TinyFish Agent can't upload files. Where a form accepts pasted résumé text (for example Greenhouse's "Enter manually"), the Agent pastes yours. Where only a file upload is accepted, it's listed under "Needs you".
- In "Fill only" mode the remote browser closes when the Agent finishes. You get the full list of what was filled, but you need to open the posting yourself to submit.

- Visa detection only reads the posting's own wording. "Unknown" means the posting doesn't say either way.
- Company names in funding headlines are found with simple rules, so a few headlines get skipped.
- The cache and rate limit are in memory, which suits a demo deployment, not heavy traffic.
