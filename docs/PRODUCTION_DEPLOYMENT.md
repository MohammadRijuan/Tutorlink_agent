# Production deployment: Vercel + Neon (free tiers)

Do the steps **in order**. Total time: about 45 minutes. Nothing here enables billing.

> **Rotate leaked secrets first.** The ZIP you uploaded earlier contained a real `.env`. In Neon, Meta, Groq and Google AI Studio, revoke those credentials and create new ones. This project ships with no `.env`.

## 0. What you need (all free)
* GitHub repository containing this folder (push the whole project).
* Neon account: a **new, empty** database (do not reuse the old one: see `DATABASE_MIGRATION.md`).
* Google AI Studio key (create it in a project **without billing**) and a Groq key.
* A Meta app with your Facebook Page and a Page access token.
* Node 22.x on your computer for the one-time database setup.

## 1. Database (Neon)
1. Neon → New project → copy two strings: the **pooled** string (host contains `-pooler`) and the **direct** string.
2. Locally:
   ```bash
   npm install
   cp apps/api/.env.example apps/api/.env
   ```
   In `apps/api/.env` set `DATABASE_URL` (pooled, with `?sslmode=require&pgbouncer=true&connection_limit=1`) and `DIRECT_URL` (direct, `?sslmode=require`), plus new random `JWT_SECRET` and `CRON_SECRET` (`openssl rand -hex 32`), and `ADMIN_EMAIL` / `ADMIN_PASSWORD` (12+ characters).
3. ```bash
   npm run db:generate
   npm run db:setup        # preflight -> migrate deploy -> verify. Stop if preflight says CONFLICT/WARNING.
   npm run admin:create    # creates your dashboard login
   ```
   `db:verify` must print "Schema verification passed".

## 2. Deploy the API (Vercel project #1)
1. Vercel → Add New → Project → import the repo.
2. **Root Directory: `apps/api`**. Framework Preset: **Other**. Leave Build/Install commands empty (they come from `vercel.json`). Node.js version: 22.x. Keep "Include source files outside of the Root Directory" **enabled** (default).
3. Environment variables (Production), all from `apps/api/.env.example`:

| Variable | Value |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Neon pooled / direct strings |
| `JWT_SECRET`, `CRON_SECRET` | new random 32+ characters |
| `WEB_ORIGIN` | your dashboard URL (fill after step 3, then redeploy) |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | your free keys (at least one) |
| `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | from Meta (verify token = any random string you choose) |
| `META_MESSENGER_URL` | `https://m.me/<your-page-username>` |
| `PUBLIC_API_URL` | this API project's own https address, e.g. `https://tutorlink-agent-api.vercel.app` (enables the native **Send Message** button) |
| `META_PUBLISH_MODE` | `dry-run` (switch to `live` only in step 6) |

4. Deploy. Open `https://<api>.vercel.app/health`; it must return `{"status":"ok"...}`.
5. If Vercel rejects `maxDuration: 300` (older Hobby projects without Fluid Compute), edit `apps/api/vercel.json` and set it to `60`; Reels are then likelier to time out, so enable Fluid Compute in Project Settings instead if you can.

## 3. Deploy the dashboard (Vercel project #2)
1. Import the same repo again. **Root Directory: `apps/web`**, Framework: Next.js.
2. Env: `API_BASE_URL` = `https://<api>.vercel.app` (no trailing slash).
3. Deploy, then put its URL into the API project's `WEB_ORIGIN` and redeploy the API.
4. Sign in with the admin email/password from step 1.

## 4. Verify the deployment (dashboard → Settings)
1. **Deployment self-check → Run checks.** Every line must be green: database + schema, **Bangla fonts**, **FFmpeg**, Messenger URL, Meta credentials, webhook secrets, AI key.
2. **Free AI health → Test every model.** At least one content model and one classifier model must say *Working* with Bangla output *Yes*.
3. **Business facts the agent may use:** enter your real service areas, programs and any extra phrases to forbid. The agent states only facts you list here.

## 5. Meta webhook (lead capture)
1. Meta App → Webhooks → Page → Callback URL `https://<api>.vercel.app/api/meta/webhook`, Verify token = your `META_VERIFY_TOKEN`. Subscribe to: `messages`, `messaging_postbacks`, `messaging_referrals`, `feed`.
2. Subscribe the app to your Page (once):
   ```bash
   curl -X POST "https://graph.facebook.com/v26.0/$PAGE_ID/subscribed_apps" \
     -d "subscribed_fields=messages,messaging_postbacks,messaging_referrals,feed" -d "access_token=$PAGE_TOKEN"
   ```
3. Permissions the Page token needs: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_messaging`, `read_insights` and **`pages_read_user_content`** (without it Meta usually refuses to return reactions and comments, which show as "—"). After adding permissions you must **generate a NEW Page access token**, update `META_PAGE_ACCESS_TOKEN` in Vercel and redeploy; the old token keeps the old permissions. Page analyzer → *Data gaps* shows Meta's exact answer for anything still missing. While the Meta app is in *Development* mode only people with a role on the app can message/comment and be captured; for the public you need Meta's Advanced Access (App Review) and the app set to *Live*.
4. Feed posts are published as a **link card with Meta's native Send Message button** (needs `PUBLIC_API_URL`). If Meta rejects the button the agent automatically posts a photo with a Messenger link instead. Reels cannot carry a native button; they end on a card with your number and the caption has the link. Also add a **Send Message** button on the Page itself in Facebook's Page settings.

## 6. Staging checklist → go live
Stay in `dry-run` until each line passes.
1. Message the Page from a tester account → a **NEW** lead appears in *Qualified leads* (enquiry text visible, label correctable).
2. Content Studio → **Let the agent decide** (dry-run): a preview is saved. Click **Review publish checks**: all green, exact caption shown.
3. In the API project set `META_PUBLISH_MODE=live`, redeploy. Publish one **feed post** manually with the draft's *Publish to Facebook* button. Check the Page: image readable, phone and CTA visible, link opens Messenger.
4. Run again until the agent produces a **Reel**; publish it manually. Check it plays and the end card shows the number.
5. Click the caption link from a tester account and send a message → the lead shows "Attributed to a post".
6. Only now switch **Agent Mode ON** (top bar). Vercel Cron then runs daily: 03:00 UTC performance import, 03:30 UTC (09:30 Bangladesh time) campaign. The agent may wait instead of posting.

## 7. Speed (make the dashboard feel instant)
* **Region:** both projects are pinned to Singapore (`sin1`) in `vercel.json`. Create your Neon project in **AWS Singapore (ap-southeast-1)** so the function and the database are next to each other and close to Bangladesh. A US region adds ~200 ms to every database call.
* The dashboard caches data in the browser and pre-loads the main pages after sign-in; images are real cacheable PNGs; the first click after a long idle can still take 1 to 3 seconds (see below).
* **Cold starts:** a free Vercel function sleeps when unused and Neon's free database sleeps after ~5 idle minutes. To keep the **function** warm, add a free pinger (UptimeRobot or cron-job.org) on `https://<api>.vercel.app/health` every 5 minutes. Do **not** point a 24/7 pinger at `/health/warm`: that wakes the database and can use up Neon's monthly free compute allowance; check your Neon plan before using it, and only during limited hours.

## 8. Vercel Hobby notes
* Hobby allows daily crons only (that is why there are two). Hobby is for **non-commercial** use under Vercel's terms; a business page should move to Vercel Pro ($20/month) or another host when you can. The code has no Vercel-specific lock-in apart from `vercel.json`.
* Free AI quotas are set by Google/Groq per account and can change; the app degrades by skipping runs, never by spending money.

## 9. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Self-check: *Latest migration is missing* | Run `npm run db:deploy` with `DIRECT_URL` pointing at the same Neon database. |
| Self-check: *FFmpeg* red | The build step `prepare-assets` could not copy the binary; check the build log. Reels fall back to photo posts. |
| Reactions/comments show "—" | Add `pages_read_user_content`, make a NEW Page token, update `META_PAGE_ACCESS_TOKEN`, redeploy. See Page analyzer → Data gaps. |
| Posts go out as photo + link, not a button | `PUBLIC_API_URL` is empty, or Meta rejected the button (shown in the Learning log). Photo + link is the designed fallback. |
| Self-check: *fonts* red | `assets/fonts/*.ttf` missing from the deployment; do not delete them. |
| Run says *free quotas are used up* | Wait for the quota reset or add the second provider's key. |
| Agent turned itself OFF | Read *Learning log*: it auto-pauses on revoked permissions, uncertain publishes, or 3 failures in 48 h. Check the Page, fix the cause, turn ON. |
| Item stuck in *Publishing* | A function was killed mid-publish. Check the Page; if the post is not there click **Confirm not on Facebook**. |
| Webhook verify fails | `META_VERIFY_TOKEN` differs between Meta and Vercel, or the API was not redeployed. |
