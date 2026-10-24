# Requirements checklist: instruction → implementation → evidence

Evidence legend: **U** = automated unit test (49 pass) · **E** = end-to-end test: real Express app + real PostgreSQL 16 with Meta mocked at the network layer (52 checks pass) · **R** = rendered and inspected (images/MP4) · **D** = real-database migration test · **S** = must be confirmed on your live deployment (Settings → Deployment self-check / manual staging steps).

| Requirement (PRD / RULES) | Status | Evidence |
|---|---|---|
| FR-01 business facts, service areas, prohibited claims | **Added** (was missing): Settings → *Business facts*; prompts use only these facts; extra prohibited phrases enforced | E, U |
| FR-02 secure admin auth, rate limits, audit | Implemented; `trust proxy` fixed for Vercel so rate limiting works | E |
| FR-03/04 official Meta APIs, permission-aware ingestion | Implemented; missing metrics stay "unavailable", never zero | S |
| FR-05 raw + normalized metrics with timestamps | Implemented; performance matching now tolerates Meta's `pageId_postId` / video id forms | U |
| FR-06 explainable lead classification | Implemented (reason + score); uncertain → NEW; admin can correct and sees enquiry text | E |
| FR-07 Bangla-first content, zero-paid AI | **Reworked**: Gemini→Groq free chain, reasoning-token fix, validation, Bangla-ratio check | U, S |
| FR-08 image/video assets via local tools | Implemented with sharp + bundled FFmpeg | R, E |
| FR-09 cadence from lead evidence + safe limits | Implemented; **frequency guard now enforced** (`MAX_POSTS_PER_7_DAYS`, `MIN_HOURS_BETWEEN_POSTS` were documented but unused before) | E |
| FR-10 dry-run before live | Implemented; dry-run preview now shows the exact final caption and all checks | E |
| FR-11 publish only via authorized endpoints | Implemented (Page `/photos`, `/video_reels`) | E (mock) / S |
| FR-12 attribution, honest uncertainty | **Fixed**: previously no post could ever be attributed (it expected a numeric post id nobody sends). Now per-post `m.me?ref=` links + comment post matching, with confidence | E |
| FR-13 experiments/decisions persist | Implemented; each published post records format/angle/style; *Strategy lab → What the agent has learned* | E |
| FR-14 emergency pause, immutable audit trail | Implemented; mode changes audited | E |
| FR-15 no paid ads / paid AI | No billing code path exists; only two free providers | U |
| FR-16 exact phone 01886-603858 on every creative, readable | Implemented and **validated before publish** on the banner SVG and on every Reel frame | R, U, E |
| FR-17 Messenger CTA on every post | Graphic CTA + clickable verified link in caption | E |
| FR-18 block publish when phone/CTA validation fails | Implemented (pre-publish checks are blocking) | E |
| Agent Mode toggle always visible | **Added to the top bar of every page** (was Settings-only); confirmation to enable; in-flight note when switching OFF | E |
| Agent Mode enforced on server; fail-safe | Verified; autonomous publish re-checks the mode right before contacting Meta | E |
| Pause on revoked permission / uncertain state / repeated failures | **Implemented** (auto-pause + audit) | E |
| Quota exhaustion handling | Run skipped and recorded; no paid fallback | U, E |
| Duplicate-post protection | Atomic claim of PUBLISHING; unique post ids; no automatic retry; stuck-PUBLISHING guard with human resolve | E |
| Content must pass language/policy checks | Bangla ratio, no invented links/phones/prices/guarantees/testimonials/rankings, profile claims, repeat detection | U |
| Creatives readable | **Fixed**: see "Defects found" #1 and #3 | R |

## Defects found in the ChatGPT build and fixed
1. **Bangla text would not render on Vercel.** Serverless has no Bengali fonts; I reproduced it (all text, including the phone number, became empty boxes). Fonts (Noto Sans Bengali, SIL OFL) are now bundled and wired into the renderer; startup fails closed if they are missing and a glyph-coverage check blocks unrenderable characters.
2. **AI settings were fragile**: a 10-second timeout, a 2,200-token cap that hidden reasoning tokens also consume (so JSON could be cut off), Groq-only, with the weakest-Bangla model first. Replaced (see `AI_MODELS.md`).
3. **Layout bugs** on 3-line Bangla headlines (text touching the phone pill, badge over text, accent bar over letters) and headline wrapping by character count. Now measured with the real shaping engine.
4. **FFmpeg would likely be missing in production**: its binary is located dynamically, which Vercel's file tracing cannot see, and the configured include path pointed at a per-app `node_modules` that npm workspaces do not create (they hoist to the repo root), so the binary was likely absent in production. The binary is now copied to `assets/bin` at build and deployed explicitly; Reels get a silent AAC track and fades.
5. **Vercel entry point** relied on auto-detection between `index.ts` and `src/server.ts`. Now an explicit, pre-compiled function with rewrites, 300 s duration, explicit file inclusion and `rhel-openssl-3.0.x` Prisma target.
6. **Attribution never worked** (see FR-12). **Page's own comments** were treated as leads. **Edited comments** were re-ingested.
7. **Schema drift**: two indexes existed in migrations but not in `schema.prisma`. Fixed and now machine-verified. Added `db:preflight` / `db:verify` for the old-database situation.
8. Missing: business profile, frequency guard, always-visible toggle, auto-pause, stuck-publish guard, Reel status polling, ambiguous-outcome handling, per-post attribution, AI health test, deployment diagnostics.
9. `db` scripts, `DIRECT_URL` required at runtime, Next proxy limited to 135 s (now 285 s with `maxDuration`), login rate limiter behind Vercel proxy, server-timezone day boundaries (now Asia/Dhaka).

## Known limits (stated plainly)
* **Not testable from source alone:** your real Meta Page and token, your Gemini/Groq keys, Graph API v26.0 behaviour at publish time, Meta App Review, the Vercel runtime. Meta calls were verified against a mock that follows Meta's documented request flow; use the staging checklist.
* Model names are config (`gemini-flash-latest` etc.); if Google/Groq retire one, the chain falls to the next and *Test every model* shows it.
* I could not run `prisma generate` with the standard engine in my sandbox (engine downloads are blocked there). The application code was run against real PostgreSQL through Prisma's engine-free client; the standard engine is what Vercel/your machine will use and is the normal, widely deployed path.
* A native "Send Message" button on an organic post cannot be added through the API; each post has a visible Messenger CTA and a clickable link instead (add a Send Message button on the Page itself).
* Reel ids: Meta returns a video id; the stored id may differ from the later post id; matching uses id suffixes to cope.
* "Roll back strategies that increase negative feedback" is only partly possible: Meta organic insights do not expose complaint counts, so the agent learns from qualified leads and your corrections.
* Booking outcomes depend on you labelling leads BOOKED.
* Vercel Hobby is non-commercial and daily-cron only; Gemini/Groq free quotas can change.
