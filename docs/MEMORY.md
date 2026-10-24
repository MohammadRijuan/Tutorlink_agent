# Project Memory / Handoff

## Current identity
- Project name: `tutorlink-ai-marketing-manager`
- Status: implementation candidate includes autonomous Facebook feed-photo/Reel publishing, adaptive daily campaign decisions, and signed Meta webhook lead capture. Full live integrations and production migration remain unverified.
- Separate from: TutorLink AI Sales Agent.
- Business: TutorLink Media, home-tuition matching in Chattogram, Bangladesh.
- North-star: qualified organic tuition leads; confirmed bookings are the downstream outcome.
- Budget rule: no paid ads, no paid AI APIs/subscriptions. Use free/local tools and verify provider terms.
- User preference: AI should autonomously analyze, plan, create Bangla content/Reels, choose hashtags and cadence, publish, evaluate leads, diagnose weak outcomes, and improve without daily owner involvement.

## Stack requested
- Frontend: Next.js, shadcn/ui, TanStack Query.
- Backend: Node.js, Express.js, Prisma, PostgreSQL, JWT.
- Responsive custom design, not a generic AI dashboard; fonts should be distinctive and support Bangla.

## Security note
Credentials were pasted in a conversation and must be treated as compromised. Rotate database credentials, Meta Page token, Gemini key, JWT secret, cron secret, and any other live secrets. Never copy the old values into source, docs, env files, screenshots, or logs. The original `DIRECT_URL` looked like it might use a pooled URL; configure a true direct connection string if the provider requires it for migrations.

## Decisions
- Lead quality outranks reach/likes/followers.
- AI may choose posting frequency from evidence, but must operate within safety and platform limits.
- Use official Meta Graph API only; no private-group/member scraping or unsolicited mass messages.
- Meta publishing starts in dry-run; enable live publishing only after permissions and a test are verified.
- AI provider decision: default to GroqCloud free tier using `openai/gpt-oss-120b` with `openai/gpt-oss-20b` as a same-provider fallback. Free limits are finite and may change; keep keys server-side and fail explicitly when both models are blocked. Gemini remains optional only when deliberately configured.
- Do not claim the AI can control Facebook's ranking algorithm or guarantee leads.
- Daily protected Vercel Cron runs the autonomous publish-or-wait campaign and Page performance monitor. Content generation can be saved in the durable `JobRun` queue; publish outcomes are audited and ambiguous Meta publishing failures are not blindly retried.
- Vercel Cron in the included config runs daily, so the agent can make one automated cadence decision per Cron invocation. Vercel Hobby is restricted to personal, non-commercial use; use a plan permitted for TutorLink commercial production.
- Store every major strategy decision with evidence, hypothesis, confidence, action, and measured result.

## Current implementation and remaining verification
- The primary Content Studio action sends optional guidance and runs the campaign; the agent can publish or wait. Guidance is persisted for future runs.
- Photo posts convert the generated SVG creative to PNG and publish via Meta Graph API. Reels render a silent H.264 MP4 slideshow with five vertical Bangla text scenes, visible phone, Messenger CTA, and hashtag; Meta's Reels Publishing API uploads the result.
- The API includes a signed Meta webhook endpoint for Page Messenger text messages and feed comments. It deduplicates event IDs and uses Groq to conservatively triage tuition enquiries; uncertain messages stay NEW, no replies are sent, and admins can correct the status.
- Additive migrations added for creative variants, PUBLISHING claim state, and inbound webhook events. Reconcile the previously observed migration drift before applying to an existing database.
- Current API and web TypeScript checks passed against the available source types; 27 unit tests passed when compiled with TypeScript and run in Node. The local dependency archive contained Windows-only native packages, so the standard `tsx` test runner could not run in this Linux environment.
- No live Groq call, current Prisma Client generation, real PostgreSQL migration, deployed FFmpeg render, real Meta webhook delivery, feed photo post, Reel publish, or Vercel deployment was verified. Staging integration tests are mandatory before production.

## Do not assume
- The Meta app has every required permission.
- Any Page insights metric is available before permission checks.
- Leads can be attributed to a post without evidence.
- A free tier offers unlimited usage or uninterrupted operation.
- AI can reliably identify every guardian from public data.
- A successful build means the durable-job migration is deployed or the Vercel worker schedule is enabled.


## Mandatory contact and lead-conversion requirements
- Every generated post, banner, image, Reel, and video must show the exact phone number **01886-603858** briefly but legibly; include it in the caption/body where supported.
- Every post must include a visible Messenger CTA and the verified configured Page conversation URL in the caption. A native per-post Facebook Send Message button is not guaranteed for organic feed publishing through the Page API.
- Never invent the Messenger URL. If it is not configured, block publishing and ask the operator to configure it.
- Pre-publish validation must check phone-number presence/readability and Messenger CTA validity.

## Non-Negotiable Product Requirement: Human Takeover

The user must be able to switch Agent Mode OFF at any time and take control. OFF must stop new autonomous side effects (especially publishing, scheduled posts, and automated messaging), preserve drafts and queued work, show a clear human-control status, and cancel in-flight tasks where possible. Any non-interruptible work must be disclosed accurately. Only an explicit authorized human action can re-enable the agent. The backend and workers must enforce this; if mode state is uncertain, automation stays OFF.

## Current deployment blockers
- `META_PUBLISH_MODE` defaults to `dry-run`; set it to `live` only after Meta credentials/permissions, verified `META_MESSENGER_URL`, signed webhook subscription, and a staging post/Reel test succeed.
- Agent Mode starts OFF and global automation starts paused. Enable both explicitly in Settings.
- Meta inbound events use Groq for conservative lead triage; correct Qualified/Unqualified/Booked outcomes and link a source post where known.
- Reel MP4 is a silent slideshow with text scenes, not AI-generated footage or narration.
- Check FFmpeg binary bundling and Vercel function size/runtime limits.
