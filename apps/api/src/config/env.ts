import "dotenv/config";
import { z } from "zod";

const optionalString = z.string().optional().default("");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  // Only the Prisma CLI (migrations) needs DIRECT_URL; the running API does not.
  DIRECT_URL: optionalString,
  JWT_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  CRON_SECRET: z.string().min(32),

  META_PAGE_ID: optionalString,
  META_PAGE_ACCESS_TOKEN: optionalString,
  META_APP_SECRET: optionalString,
  META_VERIFY_TOKEN: optionalString,
  META_GRAPH_VERSION: z.string().default("v26.0"),
  META_PUBLISH_MODE: z.enum(["dry-run", "live"]).default("dry-run"),
  META_MESSENGER_URL: optionalString.refine(value => !value || URL.canParse(value), "META_MESSENGER_URL must be a valid URL"),

  FFMPEG_PATH: optionalString,

  // Public https URL of THIS API deployment (used for the Send Message link card that Facebook fetches).
  // If empty on Vercel, VERCEL_PROJECT_PRODUCTION_URL is used automatically.
  PUBLIC_API_URL: optionalString.refine(value => !value || URL.canParse(value), "PUBLIC_API_URL must be a valid URL"),
  // auto = try a link post with the native "Send Message" button first, fall back to photo + link; photo = always photo + link
  META_POST_STYLE: z.enum(["auto", "photo"]).default("auto"),

  // --- Free AI providers (no paid fallback exists in this codebase) ---
  // "auto" uses the chains below; "template" never calls an AI provider (offline development only).
  AI_PROVIDER: z.enum(["auto", "template", "groq", "gemini"]).default("auto"),
  GEMINI_API_KEY: optionalString,
  GROQ_API_KEY: optionalString,
  // Comma-separated "provider:model" entries tried in order. Entries whose API key is missing are skipped.
  AI_CONTENT_CHAIN: z.string().default("gemini:gemini-flash-latest,gemini:gemini-flash-lite-latest,groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b"),
  AI_CLASSIFIER_CHAIN: z.string().default("groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,gemini:gemini-flash-lite-latest,gemini:gemini-flash-latest"),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().positive().default(150),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(40000),
  AI_CLASSIFIER_TIMEOUT_MS: z.coerce.number().int().positive().max(30000).default(12000),
  AI_TOTAL_BUDGET_MS: z.coerce.number().int().positive().max(240000).default(110000),

  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(1),
  JOB_LEASE_MS: z.coerce.number().int().min(30000).default(360000),
  JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(5).default(1),

  // Frequency guard applied to every autonomous publication.
  MAX_POSTS_PER_7_DAYS: z.coerce.number().int().min(1).max(21).default(7),
  MIN_HOURS_BETWEEN_POSTS: z.coerce.number().min(1).max(168).default(20),
  // With NO qualified/booked lead recorded in 7 days the agent waits this long between posts (40 h = every 2nd daily run).
  // Set equal to MIN_HOURS_BETWEEN_POSTS to post on every run regardless of lead data.
  NO_LEAD_WAIT_HOURS: z.coerce.number().min(1).max(168).default(40),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Print only the variable names, never their values.
  const names = [...new Set(parsed.error.issues.map(issue => issue.path.join(".") || "(root)"))];
  console.error(`Invalid environment configuration. Check these variables against .env.example: ${names.join(", ")}`);
  process.exit(1);
}

export const env = parsed.data;
