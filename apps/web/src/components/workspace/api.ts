/**
 * Dashboard data access. Speed model:
 *  - GET responses are cached in memory for a short time and shared between components (no duplicate requests),
 *    so moving between pages shows data instantly instead of re-fetching.
 *  - The shell prefetches the main lists right after sign-in, so the first visit to each page is already warm.
 *  - Any write (POST/PUT/PATCH/DELETE) clears the cache, and Refresh buttons call bustCache(), so data is never stale after you act.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function bustCache() { cache.clear(); inflight.clear(); }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/backend/${path.replace(/^\//, "")}`, { ...init, headers, cache: "no-store" });
  if (response.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; // session expired
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Request failed (${response.status}).`);
  return payload as T;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET") { bustCache(); return request<T>(path, init); }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;
  const promise = request<T>(path, init).then(value => { cache.set(path, { at: Date.now(), value }); return value; }).finally(() => inflight.delete(path));
  inflight.set(path, promise);
  return promise;
}

/** Warms the cache in the background; failures are ignored on purpose. */
export function prefetch(paths: string[]) { for (const path of paths) void api(path).catch(() => undefined); }

export const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not available";
export const fmt = (value?: number | null) => typeof value === "number" ? value.toLocaleString() : "—";
/** Bangladesh-time label (the audience and the cron schedule are in Asia/Dhaka). */
export const dhakaLabel = (value?: string | Date | null) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)) : "Not available";
export const imageUrl = (id: string, version?: string | null) => `/api/backend/content/${id}/asset.png${version ? `?v=${encodeURIComponent(version)}` : ""}`;
