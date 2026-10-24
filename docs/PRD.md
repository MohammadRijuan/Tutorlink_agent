# Product Requirements Document — TutorLink AI Marketing Manager

## 1. Product summary
A new, autonomous, zero-paid-budget organic marketing platform for TutorLink Media. It plans, creates, publishes, measures, and improves Facebook Page content with the single business objective of generating qualified tuition leads.

## 2. North-star objective
Maximize qualified tuition leads and ultimately confirmed tutor placements through compliant organic content. Reach, views, watch time, reactions, shares, and follower growth are supporting diagnostics only.

## 3. Business context
TutorLink Media helps guardians in Chattogram find home tutors. Service offerings may include preschool through class 12, National Curriculum, English Version, and O/A-Level Cambridge/Edexcel, with subject, location, tutor-gender, schedule, and budget needs varying by inquiry. Treat all service details as configurable facts; never invent tutor availability, credentials, pricing, or guarantees.

## 4. Users
- Owner/operator: configures business facts and grants platform authorization; should not need daily campaign management.
- Autonomous marketing agent: plans and executes permitted campaign operations.
- Human follow-up team: handles qualified leads and converts them to bookings.
- Administrator/developer: maintains infrastructure, permissions, and incident response.

## 5. Product principles
1. Lead quality outranks vanity metrics.
2. Autonomous routine operations; human intervention only for authorization, outages, policy/safety exceptions, and configuration requiring owner input.
3. Zero paid ads and zero paid AI API usage. Never silently call a paid model.
4. Evidence-driven decisions; separate observed facts from hypotheses.
5. Brand consistency: use the official Page identity and approved assets.
6. Bangla-first content for the local audience, while allowing appropriate bilingual terms.
7. Compliance with Meta policies, API permissions, copyright, privacy, and anti-spam rules.
8. Reliability and security over aggressive posting volume.

## 6. MVP scope
- Secure admin authentication with JWT.
- Business profile and campaign goal configuration.
- Meta Page connection status and read-only Page insights adapter.
- Page/content performance ingestion where permitted by Meta.
- Lead records and qualification status.
- Campaign diagnosis and decision log.
- Content brief, Bangla caption, hashtag, CTA, and Reel script generation through provider adapters.
- Media production pipeline interface (image/video generation is phased; initial local HTML/SVG + FFmpeg is preferred).
- Mandatory TutorLink contact branding on every generated post, banner, image, Reel, and video: show **01886-603858** briefly and legibly in the creative.
- A Messenger-first conversion CTA on every post: include a clear **Send Message / Message us** CTA that opens the TutorLink Facebook Page Messenger conversation, using a configured and verified Messenger URL or supported native Page CTA.
- Content calendar and autonomous cadence recommendation.
- Dry-run publishing, then official Meta publishing only after permission checks.
- Scheduled analysis, metrics-to-lead attribution, experiment tracking, audit log, and reporting.
- Emergency pause switch and bounded retry behavior.

## 7. Out of scope / prohibited
- Paid ad campaigns or ad account spend.
- Paid AI APIs, paid video subscriptions, or silent provider fallbacks.
- Scraping private groups, harvesting member lists, or extracting personal data without authorization.
- Automated unsolicited mass DMs, spam, fake engagement, engagement bait, or misleading claims.
- Guaranteed reach, guaranteed leads, or claims that AI can control Meta's ranking algorithm.
- Publishing invented tuition openings, fake testimonials, unsupported tutor claims, or inaccurate prices.
- Any autonomous action that bypasses Meta permissions or platform limits.

## 8. Mandatory contact and Messenger conversion requirements
- Exact contact number: **01886-603858**. Treat it as trusted, fixed business configuration; do not alter digits, reformat ambiguously, or substitute another number.
- Every generated social post, banner, image, Reel, and video must show the phone number visibly and legibly for a brief, intentional moment. For video/Reels, keep it on screen long enough to read (normally a short end card or branded lower-third); do not flash it so quickly that viewers cannot read it.
- Where the format supports a caption/body, also include the number in the post copy unless a platform-specific constraint prevents it.
- Every post must provide a clear Messenger CTA/button or clickable **Send Message** link that starts a conversation with the TutorLink Facebook Page. Prefer the platform's native Send Message CTA when available; otherwise use the verified, configured Page Messenger URL.
- Store the Messenger URL/Page identity in trusted business settings. Never invent a URL. If it is missing or invalid, flag the post as not publish-ready and ask the operator to configure it rather than publishing without the CTA.
- Validate these requirements before scheduling/publishing. A failed check blocks publication and reports the missing number overlay, unreadable timing, or Messenger CTA.
- The number and CTA must not obscure essential creative content, subtitles, or platform UI controls; use accessible contrast and safe margins.

## 9. Qualified lead definition
A lead is qualified only when evidence indicates:
- the person is a guardian or authorized decision-maker (or clearly requests help for a student);
- the request is for a tutoring service TutorLink actually provides;
- the location is within a configured service area or can be served;
- the need is genuine and sufficiently specific to follow up.
Collect only necessary details. Class, subjects, area, schedule, and budget are useful when voluntarily supplied. A message or reaction alone is not a qualified lead. Store qualification reason and confidence; allow a human to correct labels.

## 10. Success metrics
Primary:
- Qualified organic leads per 7/30 days.
- Cost in paid ads: zero.
- Qualified-lead-to-booking conversion rate.
- Cost per qualified lead, including any actual operational costs (never misreport as zero if a service incurs cost).

Secondary diagnostics:
- Leads attributed to post/Reel where attribution is available.
- Qualified lead rate per inbound conversation.
- Reach, views, watch-time/retention, shares, saves, meaningful comments, profile visits, clicks, and posting reliability.
- Content performance by format, topic, audience signal, and posting interval.

## 11. Autonomy model
The agent may independently:
- choose content themes and formats;
- draft and render approved classes of content;
- select relevant hashtags and CTA;
- recommend and adjust posting cadence;
- schedule/publish compliant Page content through authorized APIs;
- analyze available insights and lead outcomes;
- test variants and shift effort toward evidence-backed content;
- pause a failing experiment and retry transient errors safely.

The agent must pause and request operator intervention for:
- expired/revoked permissions, security incidents, policy ambiguity, or platform API failures that require reauthorization;
- any action that would spend money;
- changes to legal identity, business claims, prices, or service offerings without trusted configuration;
- repeated anomalous behavior or potential account compromise.

## 12. Autonomous optimization loop
1. Ingest authorized performance and lead data.
2. Attribute leads to content when reliable identifiers exist; otherwise mark attribution as uncertain.
3. Compare outcomes across sufficiently sized windows; account for low sample sizes.
4. Generate ranked hypotheses for underperformance.
5. Create controlled experiments changing a limited number of variables.
6. Publish within configured policy and frequency limits.
7. Evaluate qualified-lead outcomes, not views alone.
8. Keep a decision record explaining data, hypothesis, action, and result.
9. Roll back strategies that increase spam complaints, negative feedback, or low-quality lead volume.

## 13. Functional requirements
- FR-01: store business facts, service areas, brand assets, and prohibited claims.
- FR-02: securely authorize an administrator.
- FR-03: connect only official Meta integrations.
- FR-04: ingest only metrics and content the granted permissions allow.
- FR-05: preserve raw observations and timestamped normalized metrics.
- FR-06: classify leads with explainable reasons and confidence.
- FR-07: generate Bangla-first content using a configurable, zero-paid AI provider.
- FR-08: produce image/video assets through pluggable local tools.
- FR-09: choose posting cadence based on lead evidence and safe limits.
- FR-10: support dry-run before live publishing.
- FR-11: publish only through authorized endpoints.
- FR-12: attribute leads to content when supported; represent uncertainty honestly.
- FR-13: retain experiments and decisions for learning across restarts.
- FR-14: expose an emergency pause and immutable audit trail.
- FR-15: never run paid ads or paid AI calls.
- FR-16: enforce the exact phone number 01886-603858 on every generated post/banner/Reel/video creative, with brief but readable on-screen display.
- FR-17: include a Messenger conversation CTA on every post, using the verified configured Page Messenger URL or native Send Message action.
- FR-18: block scheduling/publishing when the phone-number or Messenger-CTA validation fails.

## 14. Non-functional requirements
- TypeScript across frontend/backend where practical.
- Zod validation at trust boundaries.
- Secure JWT handling, password hashing, least privilege, rate limits, and audit logging.
- Server-only secrets; no token leakage to browser bundles or logs.
- Idempotent scheduled jobs and publishing retries.
- Accessible responsive dashboard with keyboard support.
- Observability with structured logs and actionable error states.
- PostgreSQL as persistent system of record.
- Free-tier limits and provider terms documented; no promise of unlimited free operation.

## 14. Acceptance criteria for first usable release
- App starts from documented commands with a valid local PostgreSQL database.
- No secrets are committed.
- Admin can sign in and configure TutorLink facts.
- Page analysis reports data availability and missing permissions explicitly.
- Agent can create a campaign proposal and decision log without publishing.
- Content passes factual, brand, language, and policy checks.
- Dry-run shows exactly what would publish.
- Lead qualification and content attribution are testable.
- Live publishing defaults to dry-run and must be explicitly enabled after Page permissions, Messenger URL, webhook, and staging media uploads are verified.

## Agent Mode: Human Takeover and Manual Control

The product MUST provide a clearly visible, always-accessible **Agent Mode** toggle so an authorized human can switch autonomous operation off at any time and take control. This is a core requirement, not a future convenience.

- **Agent Mode ON:** the agent may perform only the configured and authorized automation tasks, subject to approval gates and platform permissions.
- **Agent Mode OFF (Human Takeover):** immediately stop starting new autonomous actions, scheduled publishing, content generation jobs that can cause side effects, and automated replies or outbound actions. Show a clear status such as `Human control`; do not silently continue in the background.
- Handle in-flight actions safely: cancel them where possible; otherwise mark them as in progress and explain what cannot be interrupted. Never claim an external action was cancelled unless cancellation is confirmed.
- Preserve drafts and progress. Switching off must not delete content or settings. Humans can review, edit, approve, schedule, publish, or resume work manually.
- Require an explicit human action to turn Agent Mode back on. Do not automatically re-enable it after refresh, restart, error recovery, or deployment. Persist the selected mode securely and load it before any automation starts.
- Provide a visible audit trail for mode changes and actions taken before/after takeover. Enforce the mode on the server/job worker too; hiding a UI toggle alone is insufficient.
- If the mode state cannot be verified, fail safe: autonomous actions remain disabled.

### Acceptance criteria

1. An authorized user can disable Agent Mode from the dashboard at any time.
2. Once OFF is confirmed, no new autonomous publishing, messaging, or other side-effecting tasks begin.
3. The UI clearly indicates human control and explains any non-interruptible in-flight action.
4. Drafts and queued work are retained but cannot execute autonomously while OFF.
5. Automation resumes only after an authorized user explicitly turns Agent Mode ON.



## AI Provider and Vercel Deployment Requirement

- Free-tier inference only, through a configurable provider chain (see `docs/AI_MODELS.md`). Default content chain: Google Gemini Flash (`gemini-flash-latest`, then `gemini-flash-lite-latest`) because it is markedly stronger in Bangla, then GroqCloud `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as fallbacks. Default lead-triage chain: Groq first, Gemini last. *(Updated at the owner's request after the original Groq-only default was judged insufficient for Bangla content.)*
- Do not use Ollama or require a local inference server. The app must call providers from the server-side API only.
- Store `GEMINI_API_KEY` / `GROQ_API_KEY` as server-side deployment environment variables; never expose them to browser code. Create the Gemini key in a project without billing.
- Enforce daily request limits, timeouts, bounded prompts/outputs, schema validation, and graceful handling of quota exhaustion.
- No automatic paid fallback or automatic billing enablement. If every free quota is exhausted, skip AI generation, record it, and tell the operator.
- Avoid sending secrets or unnecessary personal lead information to a provider (phones, emails and links are redacted). Gemini's free tier may use prompts to improve Google products; lead text therefore goes to Groq first. Verify current provider terms before production use.


## Autonomous publishing and inbound lead capture implementation notes
- The daily campaign runner may publish or wait based on recent posts, recorded qualified/booked leads, available insights, and saved owner guidance. It can create a square photo post or render a vertical MP4 Reel (silent AAC track) before upload.
- `POST /api/meta/webhook` verifies `X-Hub-Signature-256`, deduplicates Page Messenger and feed-comment events, and uses the configured free AI classifier chain to conservatively triage lead intent. Uncertain messages stay NEW; it never auto-replies, and admins can correct classifications.
- Messenger conversion is implemented as a prominent graphic CTA plus a verified clickable Page conversation URL in the caption. A native organic-post Send Message button is not guaranteed by Meta's Page publishing API.
- Acceptance testing must include staging photo publication, Reel MP4 upload, webhook signature and deduplication, metrics refresh, duplicate-post protection, and pause-switch enforcement. These live integration checks are not certified by source unit tests alone.
