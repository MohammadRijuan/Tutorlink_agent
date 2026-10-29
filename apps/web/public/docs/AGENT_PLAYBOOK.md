# Agent playbook: how the agent works for your Page, A to Z

## 1. What it is
An autonomous organic marketing agent for **TutorLink Tuition Media**. Every day it decides whether to post, writes Bangla content about *your real services*, designs a banner or renders a Reel, publishes to your Facebook Page with a **Send Message** button, captures the enquiries that come back, and learns from the ones you mark as qualified. It spends no money: no ads, no paid AI.

## 2. The daily cycle (Bangladesh time)
| Time | What happens |
|---|---|
| **9:00 AM** | Imports your recent Page posts and whatever numbers Meta returns (views, reactions, comments, shares). |
| **9:30 AM** | One campaign decision (below). You do nothing; Vercel Cron starts it. |
| **Any time** | Messages and comments reach the webhook and become leads; the AI labels clear tuition enquiries "Qualified" and leaves unclear ones "New" for you. |

### The 9:30 AM decision, in order
1. **Switches.** Agent Mode OFF or automation paused: stop. Live publishing not configured: stop.
2. **Safety.** An earlier post stuck in *Publishing* (unknown state): stop until you resolve it.
3. **Your scheduled drafts** that are due go first.
4. **Posting rhythm** (next section).
5. **Decide what to post** from evidence: qualified/booked leads and which posts they came from, views, engagement, recent content, repeated subjects in enquiries, and your guidance. It picks topic, audience, **post or Reel**, creative angle and design. Topics come from your real programs and facts (Settings → Business facts), rotate through every theme before repeating, and never repeat a recent one.
6. **Write** the Bangla caption and a headline + supporting line (Gemini first, Groq as backup).
7. **Check**: Bangla language, no invented links/phones/prices/guarantees/rankings, none of your forbidden phrases, not a repeat, readable layout.
8. **Design** a banner no recent post resembles (10 layouts × 8 colour palettes; no layout repeats within 5 posts, no palette within 3). Reels get their own palette.
9. **Last check** that Agent Mode is still ON, then **publish**, and record the decision, the result and the experiment variables.

## 3. Posting rhythm
| Situation | Rhythm |
|---|---|
| You have marked real enquiries **Qualified/Booked** in the last 7 days | About **daily** (at least 20 h apart) |
| **No** qualified lead recorded in 7 days | About **every 2 days** (40 h) instead of posting blindly |
| Always | Never more than 7 posts per week |
The **Publishing calendar** page shows the next run, whether it will post or wait, and exactly why. Change the numbers with `NO_LEAD_WAIT_HOURS`, `MIN_HOURS_BETWEEN_POSTS`, `MAX_POSTS_PER_7_DAYS`.

## 4. What every post contains
* **Caption:** a short hook, one numbered step per line (no more run-together paragraphs), a takeaway, and a call to message you with the child's class, subject, area and time (this brings better-quality enquiries), then `📞 01886-603858` and your hashtags (`#TutorlinkTuitionMedia` first).
* **Banner:** headline + supporting line, the phone number in a band, the Messenger call-to-action and the hashtag, in a layout/colour that differs from recent posts. One layout is modelled on your own banner (light-blue gradient, yellow phone band).
* **Send Message button:** feed posts are published as a link card with Meta's native **Send Message** call-to-action. If Meta rejects the button, the same content is published as a photo with a Messenger link instead. **Reels cannot carry a native button** (Meta's Reels API has none): the Reel ends on a card with your number and Messenger call, and the caption has the link.
* **Attribution:** every Messenger link carries a hidden tag, so an enquiry is tied to the exact post that produced it.

## 4b. Reading your leads
Captured automatically: Messenger messages and comments on your posts. **Not captured automatically:** WhatsApp and phone calls. Add those under *Qualified leads → Record a qualified enquiry* (pick the source post if you know it). This matters: the agent's learning and its daily rhythm depend on the labels you set.

## 5. When something fails
| Situation | What the agent does | What it never does | What you do |
|---|---|---|---|
| All free AI quotas used up | Skips the run, records why | Never uses paid AI, never posts template junk | Nothing; it resumes when quota resets (midnight BD time) |
| One AI model is down/retired | Uses the next model in the chain | | Optionally *Settings → Test every model* |
| AI writes something unsafe (invented phone/price/guarantee, not Bangla, repeat) | Rejects it and tries another model | Never publishes it | Nothing |
| Meta rejects the Send Message button | Publishes photo + link instead; logs the reason | Never posts twice | Nothing |
| Reel video can't be rendered | Publishes a photo post instead | Never publishes a half-made Reel | Check *Deployment self-check* |
| Meta says token/permission revoked | **Turns itself OFF** and says why | Never keeps retrying | Make a new Page token, update `META_PAGE_ACCESS_TOKEN`, redeploy, switch ON |
| Connection dropped mid-publish (post may or may not be live) | **Turns itself OFF**; marks the item | Never retries (would risk a duplicate) | Look at your Page; if it is not there click *Confirm not on Facebook*; switch ON |
| 3 failed publishes in 48 h | **Turns itself OFF** | | Read the Learning log, fix the cause, switch ON |
| Database unreachable | Does nothing (fails safe) | Never acts blind | Check Neon |
| The webhook is silent | Nothing breaks; the dashboard warns | | Re-check the Meta webhook subscription |

## 6. If it gets no quality leads
The agent **cannot create demand**; it can only post consistently and learn. When no qualified lead appears it:
1. **Slows to every 2 days** and tells you on the dashboard ("No qualified lead recorded in 7 days").
2. **Keeps exploring** different formats, angles and designs (it only commits to an angle after 2+ measured posts with a positive lead score).
3. **Never** buys ads, boosts posts, spams groups, auto-replies to people, or invents offers or results.

What **you** do in that case (in this order):
1. Check enquiries really arrive: message the Page from another account and see a lead appear. If not, fix the webhook.
2. Add the WhatsApp/phone enquiries you receive and mark them Qualified/Booked. Often the leads exist but are unrecorded.
3. Reply to Messenger enquiries quickly yourself (the agent never replies).
4. Look at *Strategy lab → What the agent has learned* and the Performance monitor: which formats/angles get views and enquiries.
5. Use **Guide the agent** to steer (below), or **Create now** to publish something specific.
6. Give it 10 to 20 posts with leads labelled before judging; early data is thin.

## 7. How to guide it
* **Guide the agent** (Content studio): free text the agent follows on every future run, e.g. *"This week focus on admission preparation. Keep the tone warm. Mention Chattogram."*
* **Business facts** (Settings): programs, service areas, facts it may state, and phrases it must never use. This is how you keep it honest and on-brand.
* **Create now** (Content studio): make a Reel/post right now, or only a preview.
* **Agent Mode switch** (top bar, every page): ON/OFF at any time. OFF = nothing new starts.
* **Pause**, delete or reschedule a draft in the Publishing calendar.
* Numbers in the Vercel environment variables (rhythm, weekly cap, AI daily budget).

## 8. Your routine
**Daily, 2 minutes:** open *Overview* and read **Needs your attention**; label new enquiries (Qualified / Unqualified / Booked).
**Weekly, 15 minutes:** open *Strategy lab* and *Performance monitor*; adjust guidance; check *Settings → Test every model* if posts failed.

## 9. What it will never do
Auto-reply to people · boost or buy ads · use paid AI · post invented prices, guarantees, results, rankings or credentials you did not list · show anyone's phone/email to the AI · publish while Agent Mode is OFF · publish twice for one item · keep going after a permission problem.

## 10. Honest limits
Facebook decides who sees organic posts; no tool guarantees leads. Exact per-post reach and audience demographics are not provided by Meta's current API for this setup. The Send Message button depends on Meta accepting it for your Page (the agent falls back safely). Free AI quotas and Vercel Hobby limits apply.
