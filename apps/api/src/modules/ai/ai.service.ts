import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { startOfDhakaDay } from "../../lib/dates.js";
import { classifyFailure, classifyProviderFailure, OperationError, retryAfterMs, type FailureCategory } from "../../lib/retry.js";

/**
 * Free-tier AI access. Only two providers exist here (Google AI Studio Gemini and GroqCloud), both used on their no-billing tiers.
 * There is deliberately no paid provider and no code path that enables billing. If every configured model is exhausted the
 * request fails clearly and the operator is told, per the project rules.
 */
export type AiProvider = "gemini" | "groq";
export type AiTask = "content" | "classifier" | "selftest";
export type ChainEntry = { provider: AiProvider; model: string };
export type AiAttempt = { provider: AiProvider; model: string; ok: boolean; category?: FailureCategory; ms: number };

export function parseChain(spec: string): ChainEntry[] {
  const seen = new Set<string>();
  const entries: ChainEntry[] = [];
  for (const raw of spec.split(",")) {
    const item = raw.trim();
    const index = item.indexOf(":");
    if (index <= 0) continue;
    const provider = item.slice(0, index).trim().toLowerCase();
    const model = item.slice(index + 1).trim();
    if ((provider !== "gemini" && provider !== "groq") || !model || seen.has(`${provider}:${model}`)) continue;
    seen.add(`${provider}:${model}`);
    entries.push({ provider, model });
  }
  return entries;
}

export function providerConfigured(provider: AiProvider) {
  return provider === "gemini" ? Boolean(env.GEMINI_API_KEY) : Boolean(env.GROQ_API_KEY);
}

/** The usable chain for a task: restricted by AI_PROVIDER (legacy single-provider values) and by which API keys exist. */
export function configuredChain(task: AiTask): ChainEntry[] {
  if (env.AI_PROVIDER === "template") return [];
  const spec = task === "classifier" ? env.AI_CLASSIFIER_CHAIN : env.AI_CONTENT_CHAIN;
  return parseChain(spec).filter(entry => (env.AI_PROVIDER === "auto" || env.AI_PROVIDER === entry.provider) && providerConfigured(entry.provider));
}

export function aiConfigured(task: AiTask = "content") {
  return env.AI_PROVIDER === "template" || configuredChain(task).length > 0;
}

// ---------------------------------------------------------------- usage accounting (daily request budget)
type Hooks = {
  fetchImpl: typeof fetch;
  record: (task: AiTask, attempt: AiAttempt) => Promise<void>;
  requestsToday: () => Promise<number>;
};

const AI_ACTIONS = ["AI_REQUEST", "AI_GENERATION_REQUESTED", "AI_LEAD_CLASSIFICATION_REQUESTED"];

const hooks: Hooks = {
  fetchImpl: (...args) => fetch(...args),
  record: async (task, attempt) => {
    try {
      await prisma.auditEvent.create({ data: { actor: "ai-service", action: "AI_REQUEST", details: { task, provider: attempt.provider, model: attempt.model, ok: attempt.ok, category: attempt.category ?? null, ms: attempt.ms } as never } });
    } catch { /* Usage logging must never break content generation. */ }
  },
  requestsToday: () => prisma.auditEvent.count({ where: { action: { in: AI_ACTIONS }, createdAt: { gte: startOfDhakaDay() } } }),
};

/** Test seam: lets unit tests replace network and database access. Returns a restore function. */
export function __setAiHooks(overrides: Partial<Hooks>) {
  const previous = { ...hooks };
  Object.assign(hooks, overrides);
  return () => Object.assign(hooks, previous);
}

export async function getAiUsage() {
  const used = await hooks.requestsToday().catch(() => null);
  return { usedToday: used, dailyLimit: env.AI_DAILY_REQUEST_LIMIT, remaining: used === null ? null : Math.max(0, env.AI_DAILY_REQUEST_LIMIT - used) };
}

export async function assertAiBudget() {
  const used = await hooks.requestsToday();
  if (used >= env.AI_DAILY_REQUEST_LIMIT) throw new OperationError(`The daily AI request budget (${env.AI_DAILY_REQUEST_LIMIT}) is used up. It resets at midnight Bangladesh time; raise AI_DAILY_REQUEST_LIMIT only if your free provider quota allows it.`, "QUOTA_EXHAUSTED", false);
}

// ---------------------------------------------------------------- JSON handling
export function parseJsonObject(text: string): unknown {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start === -1 || end < start) throw new OperationError("The AI returned invalid structured output.", "OUTPUT_INVALID", true);
  try { return JSON.parse(normalized.slice(start, end + 1)) as unknown; }
  catch { throw new OperationError("The AI returned invalid structured output.", "OUTPUT_INVALID", true); }
}

// ---------------------------------------------------------------- provider calls
type CallRequest = { system: string; prompt: string; maxOutputTokens: number; temperature: number; timeoutMs: number };

async function callGemini(entry: ChainEntry, request: CallRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(entry.model)}:generateContent`;
  let response: Response;
  try {
    response = await hooks.fetchImpl(url, {
      method: "POST",
      // The key travels in a header, never in the URL, so it cannot leak into request logs.
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxOutputTokens, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) { throw classifyFailure(error); }
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; status?: string; details?: Array<{ retryDelay?: string }> };
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  };
  if (!response.ok) {
    const providerDelay = payload.error?.details?.map(detail => retryAfterMs(detail.retryDelay)).find(delay => delay !== undefined);
    const message = `${payload.error?.status || ""} ${payload.error?.message || ""}`;
    // Google reports an invalid key as HTTP 400, not 401.
    if (response.status === 400 && /api key|API_KEY_INVALID/i.test(message)) throw new OperationError("The Gemini API key was rejected. Create a new key in Google AI Studio.", "AUTHENTICATION", false);
    throw classifyProviderFailure(response.status, message, retryAfterMs(response.headers.get("retry-after")) ?? providerDelay);
  }
  if (payload.promptFeedback?.blockReason) throw new OperationError("The AI provider blocked this prompt.", "OUTPUT_INVALID", true);
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new OperationError("The AI response hit its token limit before the JSON was complete.", "OUTPUT_INVALID", true);
  const text = (candidate?.content?.parts ?? []).filter(part => !part.thought).map(part => part.text || "").join("");
  if (!text.trim()) throw new OperationError("The AI returned an empty response.", "OUTPUT_INVALID", true);
  return text;
}

async function callGroq(entry: ChainEntry, request: CallRequest): Promise<string> {
  const isReasoningModel = entry.model.startsWith("openai/gpt-oss");
  let response: Response;
  try {
    response = await hooks.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: entry.model,
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }],
        temperature: request.temperature,
        // gpt-oss are reasoning models: hidden reasoning tokens count against this limit, so it must be generous.
        max_completion_tokens: request.maxOutputTokens,
        response_format: { type: "json_object" },
        ...(isReasoningModel ? { reasoning_effort: "low", include_reasoning: false } : {}),
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) { throw classifyFailure(error); }
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
  if (!response.ok) throw classifyProviderFailure(response.status, payload.error?.message || "", retryAfterMs(response.headers.get("retry-after")));
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") throw new OperationError("The AI response hit its token limit before the JSON was complete.", "OUTPUT_INVALID", true);
  const text = choice?.message?.content || "";
  if (!text.trim()) throw new OperationError("The AI returned an empty response.", "OUTPUT_INVALID", true);
  return text;
}

// ---------------------------------------------------------------- public API
export type GenerateJsonOptions<T> = {
  task: AiTask;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs?: number;
  /** Throw an OperationError("...", "OUTPUT_INVALID", true) to reject an answer and try the next model. */
  validate: (raw: unknown) => T;
  /** Overrides the configured chain (used by the self-test to probe one model at a time). */
  chain?: ChainEntry[];
};

export type GenerateJsonResult<T> = { value: T; provider: AiProvider; model: string; attempts: AiAttempt[]; fallbackFrom: string | null };

const NON_RECOVERABLE_FOR_PROVIDER: FailureCategory[] = ["AUTHENTICATION", "PERMISSION_DENIED"];

export async function generateJson<T>(options: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
  const chain = options.chain ?? configuredChain(options.task);
  if (chain.length === 0) throw new OperationError("No free AI provider is configured. Add GEMINI_API_KEY and/or GROQ_API_KEY to the API environment.", "CONFIGURATION", false);
  await assertAiBudget();
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? (options.task === "classifier" ? env.AI_CLASSIFIER_TIMEOUT_MS : env.AI_TIMEOUT_MS);
  const attempts: AiAttempt[] = [];
  const failedProviders = new Set<AiProvider>();
  let lastFailure: OperationError | null = null;

  for (const entry of chain) {
    if (failedProviders.has(entry.provider)) continue;
    const remainingBudget = env.AI_TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remainingBudget < 4000) break; // Leave room to finish before the serverless function limit.
    const callStarted = Date.now();
    try {
      const request: CallRequest = { system: options.system, prompt: options.prompt, maxOutputTokens: options.maxOutputTokens, temperature: options.temperature ?? 0.7, timeoutMs: Math.min(timeoutMs, remainingBudget) };
      const text = entry.provider === "gemini" ? await callGemini(entry, request) : await callGroq(entry, request);
      const value = options.validate(parseJsonObject(text));
      const attempt: AiAttempt = { provider: entry.provider, model: entry.model, ok: true, ms: Date.now() - callStarted };
      attempts.push(attempt);
      await hooks.record(options.task, attempt);
      const first = attempts[0]!;
      return { value, provider: entry.provider, model: entry.model, attempts, fallbackFrom: first.ok ? null : `${first.provider}:${first.model}` };
    } catch (error) {
      const failure = classifyFailure(error);
      lastFailure = failure;
      const attempt: AiAttempt = { provider: entry.provider, model: entry.model, ok: false, category: failure.category, ms: Date.now() - callStarted };
      attempts.push(attempt);
      await hooks.record(options.task, attempt);
      if (NON_RECOVERABLE_FOR_PROVIDER.includes(failure.category)) failedProviders.add(entry.provider);
    }
  }

  const summary = attempts.map(item => `${item.provider}:${item.model}→${item.category ?? "ok"}`).join(", ") || "no attempt completed in time";
  const everyQuota = attempts.length > 0 && attempts.every(item => item.category === "QUOTA_EXHAUSTED" || item.category === "RATE_LIMITED");
  const category: FailureCategory = everyQuota ? "QUOTA_EXHAUSTED" : lastFailure?.category ?? "TIMEOUT";
  const retryable = !everyQuota && (lastFailure?.retryable ?? true);
  throw new OperationError(`Every configured free AI model failed (${summary}). ${everyQuota ? "Free quotas are used up; they reset on the provider's schedule. Nothing was published." : "Nothing was published."}`, category, retryable, lastFailure?.retryAfterMs);
}

// ---------------------------------------------------------------- operator self-test
export type SelfTestRow = { task: "content" | "classifier"; provider: AiProvider; model: string; ok: boolean; ms: number; banglaOutput: boolean; category?: FailureCategory; message?: string };

/** Probes each configured model individually with a tiny Bangla request so the operator can see exactly what works. */
export async function runAiSelfTest(): Promise<{ rows: SelfTestRow[]; contentChain: ChainEntry[]; classifierChain: ChainEntry[] }> {
  const contentChain = configuredChain("content");
  const classifierChain = configuredChain("classifier");
  const rows: SelfTestRow[] = [];
  const tested = new Set<string>();
  for (const [task, chain] of [["content", contentChain], ["classifier", classifierChain]] as const) {
    for (const entry of chain) {
      const key = `${entry.provider}:${entry.model}`;
      if (tested.has(key)) continue;
      tested.add(key);
      const started = Date.now();
      try {
        const result = await generateJson({
          task: "selftest", chain: [entry], maxOutputTokens: 600, temperature: 0.2, timeoutMs: 25000,
          system: "You return only valid JSON.",
          prompt: 'Return a JSON object {"greeting": "<one short friendly Bangla sentence welcoming a parent who is looking for a home tutor>"}',
          validate: raw => {
            const greeting = (raw as { greeting?: unknown } | null)?.greeting;
            if (typeof greeting !== "string" || !greeting.trim()) throw new OperationError("Missing greeting.", "OUTPUT_INVALID", true);
            return greeting;
          },
        });
        rows.push({ task, provider: entry.provider, model: entry.model, ok: true, ms: Date.now() - started, banglaOutput: /[\u0980-\u09FF]/u.test(result.value) });
      } catch (error) {
        const failure = classifyFailure(error);
        rows.push({ task, provider: entry.provider, model: entry.model, ok: false, ms: Date.now() - started, banglaOutput: false, category: failure.category, message: failure.message.slice(0, 200) });
      }
    }
  }
  return { rows, contentChain, classifierChain };
}
