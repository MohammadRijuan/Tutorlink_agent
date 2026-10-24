# Project Rules

## Product rules
1. The north-star metric is qualified organic tuition leads, then confirmed bookings.
2. Views, likes, and followers are supporting diagnostics only.
3. Paid ads are forbidden.
4. Paid AI API calls and paid subscriptions are forbidden by default. Use GroqCloud free-tier `openai/gpt-oss-120b`, with `openai/gpt-oss-20b` as a same-provider fallback. Never silently switch to a paid provider; rate limits are finite and must be surfaced clearly.
5. AI chooses topics, formats, hashtags, and cadence from evidence within configured safe limits.
6. Never claim control over Meta's algorithm or guarantee reach/leads.
7. Do not publish fake testimonials, fabricated availability, fabricated tutor qualifications, unverified prices, or unsupported claims.
8. Bangla-first content for local guardians; keep language natural and culturally appropriate.
9. No spam, fake engagement, unsolicited bulk DMs, private-group scraping, or policy evasion.
10. When live mode is explicitly configured and verified, the agent may autonomously generate, render, schedule, and publish Page feed photos/Reels. It must stop for permission/security incidents, uncertain media state, unverified business claims, or any operation that may incur a fee.

## Mandatory brand and conversion rules
1. Every generated post, banner, image, Reel, and video creative must display the exact phone number **01886-603858** briefly and legibly. Video/Reel overlays must remain visible long enough to read; use a short end card or lower-third when appropriate.
2. Include **01886-603858** in the post caption/body too when the platform format allows.
3. Every post must include a **Send Message / Message us** Messenger CTA that opens the TutorLink Facebook Page conversation. Use a native CTA where supported or a verified configured Messenger URL.
4. Never invent or guess a Messenger URL. If Page identity/URL is not configured, mark the post blocked/not publish-ready and request configuration.
5. Run an automated pre-publish validation for the exact number, creative visibility/readability, and Messenger CTA. Any failure blocks scheduling/publishing until fixed.
6. Preserve safe margins, contrast, and subtitle readability; do not let the phone number or CTA cover important content.

## Engineering rules
1. TypeScript by default; strict mode.
2. Validate all external input and all AI-generated structured output.
3. AI output is a proposal, never trusted executable instruction.
- Groq (or optional Gemini) API keys must remain server-side; never expose them in Next.js client bundles.
- Apply per-user/day request limits and bounded input/output sizes. Free tier is quota-limited and may change.
- Do not send secrets or unnecessary personally identifiable lead information to the AI provider.
- On quota exhaustion or provider failure, fail safely; never enable billing or switch to a paid model automatically.
4. No secrets in source code, frontend variables, logs, screenshots, fixtures, or commits.
5. Keep `.env.example` placeholders only.
6. Use Prisma migrations; never run destructive test migrations against a real database.
7. All scheduled jobs must be idempotent and safe to retry.
8. All publishing is disabled by default (`META_PUBLISH_MODE=dry-run`).
9. Use official Meta APIs only.
10. Record optimizer decisions with evidence, hypothesis, confidence, action, and result.
11. Do not equate correlation with causation; track sample size and attribution confidence.
12. Use bounded retries, timeouts, and concurrency.
13. Keep UI responsive, accessible, and keyboard-operable.
14. Use TanStack Query for server state; do not duplicate server data in global UI state unnecessarily.
15. Use shadcn/ui primitives but do not ship an unmodified template aesthetic; maintain the distinct design system in `DESIGN.md`.
16. Do not introduce a dependency without explaining its purpose and checking maintenance/compatibility.
17. Update `MEMORY.md` when architecture, status, commands, or decisions change.

## Autonomous action policy
Allowed without daily approval:
- generate and validate posts/Reel scripts;
- render assets with configured free/local tools;
- choose cadence within configured bounds;
- schedule and publish compliant Page content after setup is authorized;
- analyze performance and optimize experiments;
- retry safe generation/transient errors; never blindly retry an ambiguous Meta publish result because it may duplicate a public post.

Must pause:
- token expired/revoked, missing permissions, security incident, suspicious activity;
- any operation that may incur a fee;
- content contains unverified business claims or personal information;
- uncertain policy compliance;
- repeated failures or anomalous posting behavior;
- database/scheduler unavailable or data too stale to make safe decisions.

## Quality gates before publishing
- Facts match trusted business profile.
- Correct Page branding and approved assets.
- Original or properly licensed media.
- Bangla language and grammar check.
- No personal data accidentally exposed.
- No prohibited claims, spam, bait, or duplicate near-identical posts.
- Clear, non-misleading CTA.
- Exact phone number 01886-603858 is visible and readable in the generated creative and included in the caption/body where supported.
- Messenger Send Message CTA/link is present, valid, and points to the configured TutorLink Page conversation.
- Automated contact/CTA validation passes; otherwise publishing is blocked.
- Rate/frequency guard passed.
- Dry-run passed during initial setup.
- Meta permissions and publisher health checked.

## Human Takeover Is Always Available

- Always provide a clear Agent Mode ON/OFF control for authorized users.
- OFF means a server-enforced kill switch for new autonomous side effects, including publishing, scheduled jobs, automated replies, and outbound messages.
- Stop/cancel in-flight work where possible and accurately report any work that cannot be interrupted.
- Never auto-enable Agent Mode on startup, refresh, crash recovery, or deployment; require explicit human reactivation.
- If mode state is unavailable or uncertain, default to OFF.
- Preserve drafts, queued items, and history during takeover; do not discard human work.
- Log mode changes and ensure the UI status reflects the authoritative backend state.



## Brand and creative output
- All public-facing copy, scripts, and on-image text must be Bangla-first. Brand names, phone number, and hashtags may remain as specified.
- Every creative must show `01886-603858` prominently, include a Bangla Messenger CTA, and include `#TutorlinkTuitionMedia`.
- Use the most recent verified Facebook Page name and profile picture when available; do not fabricate a logo or claim the DP was loaded if no snapshot exists.
- Reels must be rendered to a real MP4 before upload; a script or cover alone is never a finished video.
- Daily automation makes a lead-first publish-or-wait decision. Publishing requires live mode, verified Meta credentials/Messenger URL, and an unpaused, explicitly enabled Agent Mode.
