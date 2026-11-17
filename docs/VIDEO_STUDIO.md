# Video studio: voice-over Reels, built from your two reference videos

## What your references showed (measured, not guessed)
I could not open the Facebook links (Facebook blocks automated access), so you uploaded screen recordings. I analysed both frame by frame and measured the audio.

| | Reference 1: "SA Tuition Media" | Reference 2: "iLearn Tuition Media" |
|---|---|---|
| Length | 21.7 seconds | 1 minute 55 seconds |
| Format | **Cinematic mini-story**: a worried mother and a boy struggling with homework → a tutor arrives → the boy and mother smile → branded end card | **Presenter-style explainer**: a presenter speaking to camera |
| On screen | Almost no text; emotion carries it; end card: brand name + "Call: number" | Pinned two-line headline bar (key phrase in yellow) · big outlined animated subtitles with yellow keywords · logo watermark · phone number pinned at the bottom · photo inserts · brand end card |
| Audio | Loud, social-media mastered (about -14 LUFS), sparse speech | Continuous, fast-paced speech (about -16 LUFS) |

Both follow the same persuasion order: **problem → worry → solution → how it works → call to action**.

## What this project builds from them (all free)
Two Reel styles. The agent alternates between them (or follows the style you ask for in your instructions).

* **EXPLAINER** (about 45-85 s): greeting + the guardian's question, why choosing blindly is risky, what TutorLink really offers (only your verified facts), the levels covered, how it works in 2-3 steps, reassuring close. Pinned headline bar, big outlined subtitles with highlighted keywords, phone number pinned at the bottom, your logo watermark, branded end card.
* **STORY** (about 20-35 s): struggle → worry → turning point → relief. Cinematic, minimal text, small brand chip, end card.

Every Reel has a **Bangla voice-over** (Gemini text-to-speech, free), subtitles timed to the voice, **your Facebook Page name and profile picture** on every Reel and on the end card, and a call to message you with class, subject, area and time.

### "No cut-off" is guaranteed by construction
1. The **whole** narration is spoken once and stored with the draft.
2. The video is built **around** that audio: scene changes are placed on the natural pauses in the speech, never mid-word.
3. The video always ends **after** the last spoken word (a closing end card of at least 1.4 s).
4. If the voice cannot be produced, **no Reel is created**; the agent posts a feed post instead of a silent video.
5. If the narration would make the video longer than `REEL_MAX_SECONDS`, it is rejected before any video is made.
Verified by automated tests that measure the finished MP4 against the voice length.

### Scene visuals
* With a **free Pexels key** (`PEXELS_API_KEY`): real stock photos per scene (child studying, tutor teaching, campus, exam preparation...) with slow camera zoom. Licence: free for commercial use, no attribution needed. The visuals are generic; they never claim the people are your tutors or students.
* Without a key: animated brand backgrounds with a large pictogram of the scene's subject (books, cap, chat, family, board, laptop...). Works, but real photos look much better. **Add the Pexels key.**

### What I could NOT copy (honest limits)
* Reference 1's photoreal people and Reference 2's on-camera presenter are produced with **paid AI video/avatar tools**. Google's own staff confirm Gemini image generation has no free tier, and free avatar generators do not exist at this quality, so nothing paid is used. This build reproduces the **structure, pacing, subtitles, voice-over and branding**, not photoreal AI footage.
* I cannot hear the references, so I measured loudness, pitch and pace instead. The voice is **your choice**: Settings → Reel voice-over → listen to samples of 13 voices and press *Use this voice*. Bangla quality of free text-to-speech varies; **listen before you rely on it.**
* Free voice quota is limited per day (default budget 40 requests). One Reel uses 1-2.
* Facebook Reels cannot carry a native Send Message button; the end card shows the number and Messenger call-to-action and the caption has the link.

## Spelling and accuracy ("no spelling mistake")
Everything printed, subtitled or spoken goes through two layers before it can be used:
1. **Built-in checks** (always on): fixes ~25 common Bangla misspellings automatically (অভীভাবক→অভিভাবক, পরিক্ষা→পরীক্ষা, ভর্তী→ভর্তি, চট্রগ্রাম→চট্টগ্রাম ...) and rejects structural errors (vowel sign without a letter, joined Bangla/Latin letters, repeated characters, doubled punctuation).
2. **AI Bangla proofreader** (a separate request): corrects spelling, grammar and punctuation. It may **only correct, never rewrite**: if its output differs too much from the draft, the correction is thrown away and the draft is marked not confident.
A draft that is not confident is **rejected and regenerated once with the exact reasons**; if it still fails it is not used and nothing is published. If the AI proofreader is unavailable (quota), the draft is **not used** (`REQUIRE_PROOFREAD=true`). No automatic system can promise zero errors; this makes an error unlikely and an unchecked draft impossible. Use **Watch preview with voice** and **Review publish checks** on any draft you want to read yourself.

## Your instructions are now enforced
Previously your guidance was one weak line in the prompt. Now (Content studio → *Your instructions to the agent*):
1. You write instructions in your own words.
2. The agent turns them into **rules** and shows them back: *What I understood · I will always · I will never · Video style · Topics I will make first · I am not sure about*.
3. The rules go at the top of every prompt as **mandatory**, choose the **topics** (your topics come first), and can fix the video style.
4. Every draft is **checked against the rules**; a draft that ignores a MUST rule is rejected.
If the "I am not sure about" box lists doubts, answer them in your instructions and save again.

## Lead quality, the organic version of a paid campaign
Paid campaigns win with a clear hook, a specific audience, a clear offer and a frictionless action. The agent applies the same order in every video and post: a hook that names the guardian's problem, a reason to trust (only your verified facts), a simple 2-3 step process, and one action: **message class, subject, area and time on Messenger** (so enquiries arrive qualified). The Send Message button, per-post attribution and the lead labels close the loop. To make the offers stronger, add every **true** differentiator to *Settings → Business facts* (for example: tutor profiles are shared on request, the response time you really keep, a trial class if you really offer one). The agent never invents offers.

## Settings
`PEXELS_API_KEY` (recommended) · `TTS_VOICE` · `TTS_DAILY_LIMIT` · `REEL_WIDTH` (720 or 1080) · `REEL_MAX_SECONDS` · `REEL_REQUIRE_VOICE` · `REQUIRE_PROOFREAD` · `NO_LEAD_WAIT_HOURS` (rhythm).
Rendering a 50-second Reel takes about a minute on a free function (measured on one CPU); longer videos take proportionally longer, which is why Reels are limited to 88 s by default.
