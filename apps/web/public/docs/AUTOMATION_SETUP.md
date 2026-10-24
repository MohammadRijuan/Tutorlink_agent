# Autonomous campaign: how it behaves

## Daily cycle (Vercel Cron, Bangladesh time)
* 09:00 (03:00 UTC) `/api/cron/performance-monitor`: imports Page posts and whatever insights Meta returns.
* 09:30 (03:30 UTC) `/api/cron/content-generation`: one campaign decision, then the queued-job worker.

## One campaign decision
1. Stop if Agent Mode is OFF or automation is paused (read from the database on every run; unreadable = stay off).
2. In live mode require Page credentials and a verified `META_MESSENGER_URL`.
3. Stop if an earlier publish is stuck in PUBLISHING (uncertain Facebook state) until a human resolves it.
4. Publish any operator-scheduled item that is due.
5. Frequency guard: at most `MAX_POSTS_PER_7_DAYS`, at least `MIN_HOURS_BETWEEN_POSTS` apart; with no qualified/booked lead recorded in 7 days, wait ~3 days between experiments.
6. Choose topic, audience, format (post/Reel), creative angle and visual style from evidence: recorded qualified/booked leads (attributed per post), unique media views, engagement, recent content, repeated subjects in enquiries, and per-angle results once an angle has 2+ measured posts. Your saved guidance is applied.
7. Generate Bangla content with the free-model chain, validate it (Bangla ratio, no invented links/phones/prices/guarantees, business-profile prohibited claims, not a repeat), render the banner/Reel with the bundled Bangla font, run the pre-publish checks, re-check Agent Mode, publish, record experiments + audit + decision outcome.

## Lead capture and attribution
* Webhook `POST /api/meta/webhook` verifies `X-Hub-Signature-256` on the raw body, deduplicates events, ignores the Page's own comments and edited/deleted comments, and never auto-replies.
* Each post's caption link is `m.me/<page>?ref=tl_<contentId>`. A click arrives as a referral event; the next message from that person is attributed to that exact post (confidence 0.8-0.95). Comments are attributed by the post they are on (0.85). Everything else stays unattributed rather than guessed.
* AI triage is conservative: only a clear tuition enquiry becomes QUALIFIED; anything uncertain stays NEW. Correct labels in *Qualified leads*; the agent learns from your corrections.

## Publish requirements
`META_PUBLISH_MODE=live`; valid `META_PAGE_ID` + `META_PAGE_ACCESS_TOKEN`; `META_MESSENGER_URL`; Agent Mode ON (for autonomous runs). Reels are 1080x1920 H.264 + silent AAC MP4 rendered with the bundled FFmpeg; if rendering fails before any upload, a validated photo post is published instead.

## Automatic safety pauses
Revoked/expired token or permission (Meta 190/10/200/368, HTTP 401/403), an unclear publish outcome (dropped connection or 5xx at upload/finish), or three failed autonomous publishes in 48 hours switch Agent Mode OFF and pause automation; a human must re-enable it.
