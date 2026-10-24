# Implementation Phases

## Phase 0 — Security and setup
- Rotate all credentials previously shared in chat.
- Create a new Meta app configuration with least-privilege permissions.
- Configure GroqCloud free-tier access using a server-only API key; no Ollama/local model runtime. Confirm current free-tier limits and data-use terms.
- Set up PostgreSQL with a new database/user; never reuse an exposed credential.
- Confirm hosting plan permits the intended commercial use.
**Exit:** no exposed secrets; app configuration documented; no live publishing.

## Phase 1 — Repository foundation
- Monorepo, TypeScript strict mode, linting, formatting, environment validation.
- Express health endpoint and Next.js dashboard shell.
- Prisma schema and first migration.
- JWT admin authentication, password hashing, rate limiting.
**Exit:** clean install/build; local login works; no secret leaks.

## Phase 2 — Business profile and lead model
- Store trusted business facts, service areas, content restrictions, official brand assets.
- Lead lifecycle: new → qualified/unqualified → contacted → booked/lost.
- Qualification reasons, confidence, attribution, manual correction, audit events.
**Exit:** qualification can be tested with fixtures and is explainable.

## Phase 3 — Facebook Page Analyzer (read-only)
- Configure official Meta integration.
- Verify Page identity and granted permissions.
- Ingest accessible posts and insights; report unavailable metrics honestly.
- Build baseline by format/topic/time where data permits.
**Exit:** analysis report can distinguish observed facts, estimates, and missing data.

## Phase 4 — AI provider and strategy engine
- Provider-neutral structured-output adapter.
- Implement Groq API adapter using `openai/gpt-oss-120b` with same-provider `openai/gpt-oss-20b` fallback; enforce quotas, short timeouts, schema validation, and explicit provider failures.
- Bangla generation tests, fact-grounding, timeout/resource limits.
- Strategy recommendations and persisted decision log.
**Exit:** reproducible campaign proposal with evidence and no API publishing.

## Phase 5 — Content studio and free media
- Post templates, SVG/HTML graphics, captions, hashtag candidates, CTA.
- Implement mandatory contact branding: render **01886-603858** visibly and legibly in every generated post/banner/image/Reel/video, including a brief readable overlay/end card for video.
- Add a Messenger CTA to every post, wired to the verified configured TutorLink Page Messenger URL or supported native Send Message action.
- Add pre-publish checks that block publication when the phone number is missing/unreadable or the Messenger CTA/URL is absent/invalid.
- Bangla Reel scripts, local TTS options, subtitles, FFmpeg render pipeline.
- Asset checks, duplicate detection, brand validation.
**Exit:** create a complete draft asset bundle locally without paid services.

## Phase 6 — Dry-run campaign scheduler
- Cadence engine and content queue.
- Persistent locks/idempotency; bounded retries.
- Dry-run publishing payload and operator-visible audit.
- Emergency pause.
**Exit:** scheduler can run repeatedly without duplicates; no live publish.

## Phase 7 — Meta publishing
- Official supported Page publishing flow for eligible content types.
- Preflight permission checks and test Page verification.
- Server-side tokens only; failure handling and API limits.
**Exit:** staging feed-photo and Reel MP4 publish succeed through Meta, insights refresh, webhook signatures are verified, and the Messenger URL/phone/hashtags are checked. Live mode remains opt-in.

## Phase 8 — Attribution and autonomous optimization
- Connect content identifiers, timestamps, leads, and bookings.
- Attribution confidence and unassigned lead handling.
- Hypothesis → controlled experiment → observation window → evaluation.
- Change cadence/content mix based on qualified leads, not vanity metrics.
**Exit:** optimizer decisions include evidence and measurable outcomes.

## Phase 9 — Deployment and reliability
- Deploy web/API to hosting whose terms permit business use.
- Configure external scheduler if needed; test cold starts, timeout, retries, and database connections.
- Backups/export, logs, alerts, recovery, credential rotation.
**Exit:** end-to-end unattended dry run, then controlled live trial; actual uptime and costs documented.

## Phase 10 — Safe autonomy
- Gradually enable autonomous decisions within limits.
- Automated pause on security/policy failures, unusual negative feedback, stale data, or repeated errors.
- Periodic quality and lead conversion evaluation.
**Exit:** autonomous operation demonstrated over multiple cycles with auditable decisions.

## Important sequencing
Do not build a “fully autonomous” label before the data, publishing permissions, scheduler, and attribution loop work. Do not use a single post's results to make strong conclusions. Organic reach and lead generation are probabilistic.

## Required Feature: Agent Mode Toggle / Human Takeover

Implement this as a foundational control before enabling autonomous publishing or messaging. Include the dashboard toggle, persisted backend state, server-side checks in every worker/scheduler/side-effecting pipeline, safe handling of in-flight jobs, audit logging, and tests proving OFF blocks new autonomous actions. Fail closed (OFF) when the state cannot be verified. Agent Mode must never reactivate without an explicit authorized user action.



## Current delivery checkpoint (2026-10-21)
The source now includes the adaptive campaign runner, Meta photo/Reel publishing adapter, FFmpeg MP4 renderer, signed inbound webhook ingestion, lead attribution where the referral identifies a post, and additive migrations. The remaining exit gate is live staging verification: regenerate Prisma Client on the deployment platform, reconcile migration history, test a Page photo post and Reel upload, confirm webhook subscription/deduplication, and verify FFmpeg inclusion/runtime on Vercel. Do not call the deployment production-verified until those tests pass.
