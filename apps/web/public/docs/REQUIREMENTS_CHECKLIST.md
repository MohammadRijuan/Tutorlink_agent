# Requirements checklist: instruction → implementation → evidence

Evidence legend: **U** = automated unit test (see the v1.1 count below) · **E** = end-to-end test: real Express app + real PostgreSQL 16 with Meta mocked at the network layer (see the v1.1 count below) · **R** = rendered and inspected (images/MP4) · **D** = real-database migration test · **S** = must be confirmed on your live deployment (Settings → Deployment self-check / manual staging steps).

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
* **Correction (v1.1):** v1.0 said a native Send Message button could not be added. Meta's Page Feed reference documents a `call_to_action` on link posts, so v1.1 publishes feed posts as link cards with the button and falls back to photo + link if Meta rejects it. It is verified against a mock only; confirm on your Page. Reels still cannot carry a native button.
* Reel ids: Meta returns a video id; the stored id may differ from the later post id; matching uses id suffixes to cope.
* "Roll back strategies that increase negative feedback" is only partly possible: Meta organic insights do not expose complaint counts, so the agent learns from qualified leads and your corrections.
* Booking outcomes depend on you labelling leads BOOKED.
* Vercel Hobby is non-commercial and daily-cron only; Gemini/Groq free quotas can change.


## Version 1.1: changes requested after the first deployment
| Request | What changed | Evidence |
|---|---|---|
| Reactions/comments/shares show "—" | Root cause: one bundled Meta request failed and the code silently dropped all three. Now each metric is fetched separately and the real Meta error and fix are shown (Page analyzer → Data gaps). Missing permission to add: `pages_read_user_content`, then a NEW token. | U |
| Unique media views always 0 | Meta returns an impossible 0 for posts that have views; now treated as *unavailable*, never as zero, with an explanation | U |
| Posting every 3 days is too slow | Rhythm is now daily with qualified leads, **every 2 days** without (`NO_LEAD_WAIT_HOURS=40`); forecast shown on the Calendar and Overview | U (7 cadence tests), E |
| "What is the Publishing calendar for?" | Page rewritten; shows the next run, whether it will post or wait and why, the last post, and recently published posts | E |
| Could not test Reels | **Create now** (Content studio): choose Post/Reel/agent's choice, preview or publish immediately; safety checks still apply | E (real MP4 upload) |
| Steps ran together in the caption | Prompt requires a hook, one numbered step per line, takeaway and call-to-action; a formatter fixes dense paragraphs; all hashtags are now actually posted (v1.0 dropped all but one) | U |
| Wanted the native Messenger button, not a link | Link-card posts with Meta's Send Message call-to-action, public share page for the card image, safe fallbacks | E (mock Meta) |
| New banner style like the sample; designs must differ every time | 10 layouts × 8 palettes (one modelled on your banner), subtitle line, wide card variant; no layout repeats within 5 posts, no palette within 3 | R, U |
| Owner's real services | Business facts now start from your banner (programs, CUET/CU/CMC, verified teachers); credential claims are allowed only when you list them | U |
| Site slow | Removed the API call from every navigation; browser cache + prefetch; images as cacheable PNGs (list payload ~15 KB per draft → none); Singapore region; lazy-loaded image engine; keep-warm endpoint | E, measured |
| "What do I do / what does it do if it fails or gets no leads" | `docs/AGENT_PLAYBOOK.md`; dashboard "Needs your attention" list | E |
| Bangla hashtag/vowel-sign bug | Hashtags with vowel signs (#হোমটিউটর) and subject names like গণিত were being damaged by letter-only patterns; fixed and tested | U |

Verification for v1.1: 70+ unit tests and a 52-check end-to-end run (real Express + real PostgreSQL, Meta mocked), a dashboard run through the Next.js proxy (sign-in, data endpoints, PNG delivery, cookie handling), all 10 layouts × 3 sizes rendered and inspected, a Reel MP4 rendered and inspected, and the production build path.


## Version 1.2: voice-over Reels, spelling safety, enforced instructions
| Request | What changed | Evidence |
|---|---|---|
| Videos/Reels like the two references, with voice, using my Page name and logo; the old slideshow "looks so bad and has no voice" | New **video studio** with two styles (story, explainer): Bangla voice-over (free Gemini TTS), kinetic subtitles with highlighted keywords, pinned headline bar, phone pinned, Page logo and name on every Reel, branded end card, photo (Pexels) or illustrated scenes with camera movement. The old silent slideshow is removed. See `VIDEO_STUDIO.md` (includes the measured analysis of both references). | U, E, R |
| Every video complete, no cut-off voice | Voice is generated once for the whole script; scene changes land on natural pauses; the video always outlasts the last word; no voice = no Reel (feed post instead) | U, E (finished MP4 measured against the voice) |
| No spelling mistakes in video, reels, banner, content | Two layers: built-in Bangla checks (auto-fix ~25 common misspellings, reject structural errors) + AI proofreader that may only correct; unchecked drafts are never used | U, E |
| Agent does not follow my instructions | Instructions are interpreted into rules and shown back, are mandatory in prompts, choose topics, can fix the video style, and every draft is checked against them | U, E |
| Reduce 2 days to 1.5 days | `NO_LEAD_WAIT_HOURS=33` and the campaign now runs twice a day (9:30 AM and 7:30 PM Bangladesh time); gaps alternate 34 h and 38 h | U, E |
| Lead quality like a paid campaign, organically | Hook, trust, process and one qualifying action (class, subject, area, time) in every video/post; Send Message button; per-post attribution; see `VIDEO_STUDIO.md` | E |
| Banner styles like my example | Done in 1.1 (10 layouts × 8 palettes incl. your style) | R |

Verification for 1.2 (run on the restored and rebuilt project after a sandbox reset): 98 unit tests; a 41-check end-to-end run against real PostgreSQL with Meta and the Google AI services mocked at the network layer (voice Reel published as a real MP4 with measured audio, preview, proofreading rejection, spelling auto-fix, instruction interpretation, voice-failure fallback, link card, rhythm, webhook attribution, auto-pause, stuck-publish); both Reel styles rendered and inspected frame by frame; production build.
**Not testable from here:** the real quality of Gemini's Bangla voices (listen to samples in Settings), your Pexels key, Facebook accepting the Reel, and Vercel timing. A 50-second Reel rendered in about a minute on one CPU; if a run ever times out, lower `REEL_MAX_SECONDS` or keep `REEL_WIDTH=720`.
