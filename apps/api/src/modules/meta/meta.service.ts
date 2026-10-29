import { env } from "../../config/env.js";
import { OperationError, retryAfterMs, withRetry } from "../../lib/retry.js";

export class MetaApiError extends OperationError {
  status: number;
  /** Meta's own error code and (token-free) message, for operator-facing diagnostics. */
  metaCode: number | null = null;
  metaDetail = "";
  constructor(message: string, status = 502, waitMs?: number) {
    const category = status === 403 ? "PERMISSION_DENIED" : status === 429 ? "RATE_LIMITED" : status === 400 ? "CONFIGURATION" : "PROVIDER_UNAVAILABLE";
    super(message, category, status === 429 || [500, 502, 503, 504].includes(status), waitMs);
    this.status = status;
  }
}

export function sanitizeMetaErrorMessage(message: string, accessToken: string) {
  const withoutToken = accessToken ? message.replaceAll(accessToken, "[REDACTED]") : message;
  return withoutToken
    .replace(/https?:\/\/\S+/gi, "[URL REDACTED]")
    .replace(/([?&]access_token=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}

function graphOperation(path: string) {
  if (path === env.META_PAGE_ID) return "page";
  if (path === `${env.META_PAGE_ID}/posts`) return "page_posts";
  if (path.endsWith("/insights")) return "post_insights";
  return "other";
}

async function graph<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) {
    throw new MetaApiError("Facebook Page ID and Page access token are not configured.", 400);
  }
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  url.searchParams.set("access_token", env.META_PAGE_ACCESS_TOKEN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return withRetry(async () => {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string; code?: number; error_subcode?: number; type?: string };
      [key: string]: unknown;
    };
    if (!response.ok || payload.error) {
      const metaError = payload.error;
      const code = metaError?.code;
      console.error(JSON.stringify({
        event: "meta_graph_request_failed",
        operation: graphOperation(path),
        httpStatus: response.status,
        errorCode: code ?? null,
        errorSubcode: metaError?.error_subcode ?? null,
        errorType: metaError?.type ?? null,
        errorMessage: sanitizeMetaErrorMessage(metaError?.message || "", env.META_PAGE_ACCESS_TOKEN),
      }));
      const status = code === 190 || code === 10 || code === 200 || response.status === 401 || response.status === 403
        ? 403
        : [4, 17, 32, 613].includes(code || 0) || response.status === 429
          ? 429
          : [500, 502, 503, 504].includes(response.status)
            ? response.status
            : 400;
      const message = status === 403
        ? "Meta denied the request. Check Page permissions and the configured access token."
        : status === 429
          ? "Meta rate-limited the request."
          : status >= 500
            ? "Meta is temporarily unavailable."
            : "Meta rejected the request. Check the Page configuration and requested permissions.";
      const failure = new MetaApiError(message, status, retryAfterMs(response.headers.get("retry-after")));
      failure.metaCode = typeof code === "number" ? code : null;
      failure.metaDetail = sanitizeMetaErrorMessage(metaError?.message || "", env.META_PAGE_ACCESS_TOKEN).slice(0, 300);
      throw failure;
    }
    return payload as T;
  }, { maxAttempts: 2, baseDelayMs: 350, maxDelayMs: 1500 });
}

export type MetaPost = { id: string; message?: string; created_time?: string; permalink_url?: string };
export type DataGap = { area: string; code: number | null; message: string; fix: string };

function explainGap(area: string, error: unknown): DataGap {
  const code = error instanceof MetaApiError ? error.metaCode : null;
  const detail = error instanceof MetaApiError ? error.metaDetail : "";
  const permission = code === 10 || code === 200 || code === 190 || /permission/i.test(detail);
  const fix = permission
    ? "Add the missing permission to the app/token (for reactions and comments this is usually pages_read_user_content together with pages_read_engagement), generate a NEW Page access token, update META_PAGE_ACCESS_TOKEN in Vercel and redeploy."
    : code === 100
      ? "Meta does not support this field/metric for this Page or API version. The agent works without it."
      : "Temporary or unknown Meta response. Press Analyze Page again; if it persists check the Vercel function logs.";
  return { area, code, message: (detail || (error instanceof Error ? error.message : "unknown error")).slice(0, 300), fix };
}

type CountResult = Map<string, number | null>;

/** Reads one count per post in a single list call. A failure never affects the other metrics; it becomes a reported data gap. */
async function listCounts(area: string, fieldSpec: string, pick: (row: Record<string, any>) => number | null | undefined, gaps: DataGap[]): Promise<CountResult> {
  const out: CountResult = new Map();
  try {
    const payload = await graph<{ data: Array<Record<string, any> & { id: string }> }>(`${env.META_PAGE_ID}/posts`, { fields: `id,${fieldSpec}`, limit: "10" });
    for (const row of payload.data) { const value = pick(row); out.set(row.id, typeof value === "number" ? value : null); }
  } catch (error) { gaps.push(explainGap(area, error)); }
  return out;
}

export async function analyzePage() {
  const gaps: DataGap[] = [];
  const page = await graph<{ id: string; name: string; picture?: { data?: { url?: string } } }>(env.META_PAGE_ID, { fields: "id,name,picture" });
  let followers: number | null = null;
  let likes: number | null = null;
  try {
    const counters = await graph<{ followers_count?: number; fan_count?: number }>(env.META_PAGE_ID, { fields: "followers_count,fan_count" });
    followers = typeof counters.followers_count === "number" ? counters.followers_count : null;
    likes = typeof counters.fan_count === "number" ? counters.fan_count : null;
  } catch (error) { gaps.push(explainGap("followers", error)); }

  const postsPayload = await graph<{ data: MetaPost[]; paging?: { next?: string } }>(`${env.META_PAGE_ID}/posts`, { fields: "id,message,created_time,permalink_url", limit: "10" });
  // Independent, parallel calls: one rejected field can no longer blank the others (the previous bundled request did).
  const [reactions, comments, shares] = await Promise.all([
    listCounts("reactions", "reactions.limit(0).summary(true)", row => row.reactions?.summary?.total_count, gaps),
    listCounts("comments", "comments.limit(0).summary(true)", row => row.comments?.summary?.total_count, gaps),
    listCounts("shares", "shares", row => (row.shares?.count ?? 0), gaps),
  ]);

  let insightErrorReported = false;
  const posts = await Promise.all(postsPayload.data.map(async (post) => {
    const insights: Record<string, number | string | null> = {};
    let insightsAvailable = false;
    try {
      const result = await graph<{ data: Array<{ name: string; values?: Array<{ value?: number | string }> }> }>(`${post.id}/insights`, { metric: "post_media_view,post_total_media_view_unique,post_clicks" });
      for (const metric of result.data) {
        const value = metric.values?.[0]?.value;
        insights[metric.name] = typeof value === "number" || typeof value === "string" ? value : null;
      }
      insightsAvailable = result.data.some(metric => metric.values?.[0]?.value !== undefined);
      // Meta sometimes reports 0 unique viewers for posts that clearly have views. That is impossible, so treat it as "unavailable", never as zero.
      const views = Number(insights.post_media_view ?? 0);
      if (Number(insights.post_total_media_view_unique ?? 0) === 0 && views > 0) insights.post_total_media_view_unique = null;
    } catch (error) { if (!insightErrorReported) { insightErrorReported = true; gaps.push(explainGap("post insights", error)); } }
    return {
      id: post.id, message: post.message || "(No caption)", createdAt: post.created_time || null, permalink: post.permalink_url || null,
      shares: shares.get(post.id) ?? null, comments: comments.get(post.id) ?? null, reactions: reactions.get(post.id) ?? null,
      mediaType: "unknown", insights, insightsAvailable,
    };
  }));
  if (posts.some(post => post.insightsAvailable && post.insights.post_total_media_view_unique === null && Number(post.insights.post_media_view ?? 0) > 0)) {
    gaps.push({ area: "unique media views", code: null, message: "Meta returned 0 unique viewers for posts that have views.", fix: "Treated as unavailable. Use Media views as the attention signal; no action needed." });
  }
  return {
    page: { id: page.id, name: page.name, picture: page.picture?.data?.url || null, followers, likes },
    posts, gaps, fetchedAt: new Date().toISOString(),
    coverage: { postCount: posts.length, insightsAvailable: posts.filter(p => p.insightsAvailable).length, hasMore: Boolean(postsPayload.paging?.next) },
  };
}
