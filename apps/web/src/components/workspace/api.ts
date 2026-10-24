export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/backend/${path.replace(/^\//, "")}`, { ...init, headers, cache: "no-store" });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Request failed (${response.status}).`);
  return payload as T;
}
export const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not available";
export const fmt = (value?: number | null) => typeof value === "number" ? value.toLocaleString() : "—";
