export type FailureCategory =
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "OUTPUT_INVALID"
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "QUOTA_EXHAUSTED"
  | "PERMISSION_DENIED"
  | "WORKER_INTERRUPTED"
  | "VALIDATION"
  | "UNKNOWN";

export class OperationError extends Error {
  constructor(
    message: string,
    readonly category: FailureCategory,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "OperationError";
  }
}

export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const duration = /^(\d+(?:\.\d+)?)s$/i.exec(value.trim());
  if (duration) return Math.min(Number(duration[1]) * 1000, 24 * 60 * 60 * 1000);
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, Math.min(timestamp - now, 24 * 60 * 60 * 1000));
}

export function classifyProviderFailure(status: number, message: string, waitMs?: number): OperationError {
  const normalized = message.toLowerCase();
  if (status === 401) return new OperationError("The AI provider rejected its credentials. Check the server-side API key.", "AUTHENTICATION", false);
  if (status === 403) return new OperationError("The AI provider denied access. Check API permissions and billing/quota settings.", "PERMISSION_DENIED", false);
  if (status === 404) return new OperationError("The configured AI model was not found. Check the model name.", "CONFIGURATION", false);
  if (status === 429 && /quota|daily limit|per.day|billing|exhausted/i.test(normalized)) {
    return new OperationError("The AI provider quota is exhausted. Check provider quota reset time before retrying.", "QUOTA_EXHAUSTED", false, waitMs);
  }
  if (status === 429) return new OperationError("The AI provider is rate limiting requests.", "RATE_LIMITED", true, waitMs);
  if ([500, 502, 503, 504].includes(status)) return new OperationError("The AI provider is temporarily unavailable.", "PROVIDER_UNAVAILABLE", true, waitMs);
  if (status === 408) return new OperationError("The AI provider request timed out.", "TIMEOUT", true, waitMs);
  return new OperationError(`The AI provider rejected the request (HTTP ${status}). Check the model configuration and request.`, "VALIDATION", false);
}

export function classifyFailure(error: unknown): OperationError {
  if (error instanceof OperationError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new OperationError("The operation timed out.", "TIMEOUT", true);
  }
  if (error instanceof Error && /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|fetch failed|socket hang up/i.test(error.message)) {
    return new OperationError("A temporary network error interrupted the operation.", "NETWORK_ERROR", true);
  }
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (/^P100[0128]$|^P1017$/.test(code)) {
    return new OperationError("The database is temporarily unavailable.", "NETWORK_ERROR", true);
  }
  return new OperationError("The operation failed unexpectedly. Review configuration and server logs.", "UNKNOWN", false);
}

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const random = options.random ?? Math.random;
  const wait = options.sleep ?? sleep;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const classified = classifyFailure(error);
      if (!classified.retryable || attempt >= options.maxAttempts) throw classified;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await wait(Math.max(classified.retryAfterMs ?? 0, Math.floor(random() * ceiling)));
    }
  }
}

export async function withFallback<T>(primary: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    const classified = classifyFailure(error);
    if (!classified.retryable || !fallback) throw classified;
    return fallback();
  }
}
