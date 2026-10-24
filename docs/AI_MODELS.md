# AI models: what is used and why

## Verdict on the previous default
`openai/gpt-oss-120b` on Groq (free) was **not a safe sole choice** for this product:
1. It is an English-first reasoning model; its Bangla is the weakest part of this workload, and every post is Bangla.
2. It spends hidden reasoning tokens inside the completion limit; the previous 2,200-token cap and 10-second timeout could cut the JSON mid-answer and make runs fail.
3. Groq's free tier limits it to roughly 8,000 tokens per minute, which is tight for long Bangla prompts and outputs.
It remains a good **fallback** and a good **lead classifier** (short inputs, high daily request allowance).

## What is configured now (free tiers only)
| Task | Order tried | Why |
|---|---|---|
| Content (captions, headlines, Reel scenes) | `gemini-flash-latest` → `gemini-flash-lite-latest` → Groq `openai/gpt-oss-120b` → Groq `openai/gpt-oss-20b` | Gemini Flash models are markedly stronger in Bangla and have a larger context/output budget; `-latest` aliases keep working when Google retires a version. |
| Inbound lead triage | Groq `openai/gpt-oss-120b` → `gpt-oss-20b` → Gemini flash-lite → flash | Short inputs, many requests/day on Groq, and Groq does not train on API data by default. Gemini's free tier may use prompts to improve Google products, so lead text goes there only as a last resort (phones/emails/links are redacted before any model sees a message). |

Change the order or models with `AI_CONTENT_CHAIN` / `AI_CLASSIFIER_CHAIN` (`provider:model`, comma separated). Entries whose API key is missing are skipped.

## Guarantees in code
* Free only: the code contains two providers and no billing path. Create the Gemini key in a Google AI Studio project **without billing**, so it can never be charged.
* On a quota/rate/model-retired error the next model is tried automatically; a bad API key skips that provider's remaining models; an answer that fails validation (not Bangla, invented phone/link/price/guarantee, too short, repeated) is rejected and the next model tries.
* Reasoning models get `reasoning_effort: low` and a 3,500-token budget; Gemini output is requested as JSON and "thinking" parts are ignored.
* Daily request budget (`AI_DAILY_REQUEST_LIMIT`, default 150, counted per Bangladesh day) and a total time budget per run keep the function inside Vercel's limit.
* If every model is exhausted the run is skipped, recorded, and nothing is published; there is no paid fallback.

## Verify on your own keys
Dashboard → **Settings → Free AI health → Test every model** sends one tiny Bangla request per model and shows which work, their speed, and whether the output was Bangla. Free-tier quotas are set by Google/Groq per account and change; check your own limits in AI Studio / the Groq console.
