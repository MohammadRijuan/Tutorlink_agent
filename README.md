# TutorLink AI Marketing Manager

An autonomous, lead-first organic Facebook marketing agent for TutorLink Tuition Media (Chattogram).
It decides what to post (feed banner or Reel), writes Bangla content, renders the creative, publishes through the
official Meta APIs, captures Messenger/comment enquiries through signed webhooks, and learns from qualified leads.
Everything runs on free tiers: Vercel Hobby, Neon Postgres, Google Gemini (free) and Groq (free).

| Part | Where | Deploys as |
|---|---|---|
| Dashboard (Next.js) | `apps/web` | Vercel project #1 |
| API + agent + cron + webhook (Express) | `apps/api` | Vercel project #2 |
| Database | Neon (free) | new, empty database |

## Start here
1. **Deploy:** follow [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md) (about 45 minutes, in order).
2. **Database trouble / old migration history:** [`docs/DATABASE_MIGRATION.md`](docs/DATABASE_MIGRATION.md).
3. **How the agent works, what it does when something fails or no leads come, and what you do:** [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md).
4. **Which AI model and why:** [`docs/AI_MODELS.md`](docs/AI_MODELS.md).
5. **Every requirement vs. what is implemented and how it was verified:** [`docs/REQUIREMENTS_CHECKLIST.md`](docs/REQUIREMENTS_CHECKLIST.md).

## Local development
```bash
npm install                                   # Node 22.x
cp apps/api/.env.example apps/api/.env        # fill DATABASE_URL, DIRECT_URL, JWT_SECRET, CRON_SECRET, AI keys
cp apps/web/.env.example apps/web/.env.local  # API_BASE_URL=http://localhost:4000
npm run db:generate
npm run db:setup                              # preflight -> migrate deploy -> verify (empty database only)
npm run admin:create                          # uses ADMIN_EMAIL / ADMIN_PASSWORD from apps/api/.env
npm run dev                                   # API :4000, dashboard :3000
npm test                                      # unit tests
```
Keep `META_PUBLISH_MODE=dry-run` until the staging checklist in the deployment guide passes.

## Safety model (enforced on the server, not just the UI)
* A fresh install is **paused with Agent Mode OFF**. The Agent Mode switch is in the top bar of every page.
* Turning it ON needs an explicit confirmation; it is never re-enabled automatically after a restart or deploy.
* Autonomous publishing re-reads Agent Mode immediately before contacting Meta, so switching it OFF wins mid-run.
* The agent **auto-pauses** itself (and tells you) on: revoked/expired Meta permissions, an uncertain publish outcome, three failed publishes in 48 h, or an item stuck in PUBLISHING.
* No paid AI, no paid ads, no automatic billing. If every free model is out of quota the run is skipped and recorded.
* Every creative is validated before publish: exact phone number, Messenger CTA and hashtag on the image/video frames, only characters the bundled Bangla font can draw, no invented links/phones/prices/guarantees.

## Honest limits
Live integrations (your real Meta Page, Gemini/Groq keys, Vercel runtime) cannot be proven from source alone; the
dashboard's **Settings → Deployment self-check** and **Free AI health → Test every model** prove them on your deployment.
See the "Known limits" section of the checklist.
