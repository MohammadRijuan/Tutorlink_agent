import { env } from "../../config/env.js";
import { OperationError, retryAfterMs, withRetry } from "../../lib/retry.js";

export class MetaApiError extends OperationError {
  status: number;
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
      throw new MetaApiError(message, status, retryAfterMs(response.headers.get("retry-after")));
    }
    return payload as T;
  }, { maxAttempts: 2, baseDelayMs: 350, maxDelayMs: 1500 });
}

export type MetaPost = {
  id: string; message?: string; created_time?: string; permalink_url?: string;
  shares?: { count?: number }; comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } }; attachments?: { data?: Array<{ media_type?: string; media?: { source?: string; image?: { src?: string } } }> };
};
export async function analyzePage() {
  const page = await graph<{ id: string; name: string; picture?: { data?: { url?: string } }; followers_count?: number; fan_count?: number }>(env.META_PAGE_ID, { fields: "id,name,picture" });
  let followers: number | null = null;
  let likes: number | null = null;
  try {
    const counters = await graph<{ followers_count?: number; fan_count?: number }>(env.META_PAGE_ID, { fields: "followers_count,fan_count" });
    followers = typeof counters.followers_count === "number" ? counters.followers_count : null;
    likes = typeof counters.fan_count === "number" ? counters.fan_count : null;
  } catch { /* Basic Page identity is useful even when audience counters are not permitted. */ }
  let postsPayload: { data: MetaPost[]; paging?: { next?: string } };
  try {
    postsPayload = await graph<{ data: MetaPost[]; paging?: { next?: string } }>(`${env.META_PAGE_ID}/posts`, {
      fields: "id,message,created_time,permalink_url,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true),attachments{media_type,media}", limit: "10",
    });
  } catch {
    postsPayload = await graph<{ data: MetaPost[]; paging?: { next?: string } }>(`${env.META_PAGE_ID}/posts`, {
      fields: "id,message,created_time,permalink_url", limit: "10",
    });
  }
  const posts = await Promise.all(postsPayload.data.map(async (post) => {
    let insights: Record<string, number | string | null> = {};
    let insightsAvailable = false;
    try {
      const result = await graph<{ data: Array<{ name: string; values?: Array<{ value?: number | string }> }> }>(`${post.id}/insights`, { metric: "post_media_view,post_total_media_view_unique,post_clicks" });
      for (const metric of result.data) {
        const value = metric.values?.[0]?.value;
        insights[metric.name] = typeof value === "number" || typeof value === "string" ? value : null;
      }
      insightsAvailable = result.data.some(metric => metric.values?.[0]?.value !== undefined);
    } catch { /* Keep unsupported metrics explicitly unavailable; never turn them into zero. */ }
    return {
      id: post.id, message: post.message || "(No caption)", createdAt: post.created_time || null,
      permalink: post.permalink_url || null, shares: post.shares?.count ?? null,
      comments: post.comments?.summary?.total_count ?? null, reactions: post.reactions?.summary?.total_count ?? null,
      mediaType: post.attachments?.data?.[0]?.media_type || "unknown", insights, insightsAvailable,
    };
  }));
  return {
    page: { id: page.id, name: page.name, picture: page.picture?.data?.url || null, followers, likes },
    posts, fetchedAt: new Date().toISOString(),
    coverage: { postCount: posts.length, insightsAvailable: posts.filter(p => p.insightsAvailable).length, hasMore: Boolean(postsPayload.paging?.next) },
  };
}
