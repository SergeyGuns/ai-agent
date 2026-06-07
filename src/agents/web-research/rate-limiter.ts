/**
 * Rate Limiter для контроля частоты запросов.
 * Реализует token bucket алгоритм.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(requestsPerSecond: number = 2) {
    this.maxTokens = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillRate = requestsPerSecond / 1000; // per ms
    this.lastRefill = Date.now();
  }

  /**
   * Подождать пока не будет доступен токен
   */
  async acquire(): Promise<void> {
    this._refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Ждём пока появится токен
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((r) => setTimeout(r, waitMs));
    this._refill();
    this.tokens -= 1;
  }

  private _refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

/**
 * Retry с экспоненциальным backoff для внешних запросов.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryableStatuses?: number[];
    onRetry?: (attempt: number, error: Error, delay: number) => void;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    retryableStatuses = [429, 500, 502, 503, 504],
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;

      // Проверяем стоит ли retry
      const statusCode = e.statusCode || e.status;
      const isRetryable =
        retryableStatuses.includes(statusCode) ||
        e.message?.includes("timeout") ||
        e.message?.includes("ECONNREFUSED") ||
        e.message?.includes("ETIMEDOUT") ||
        e.message?.includes("ENOTFOUND");

      if (!isRetryable || attempt > maxRetries) {
        throw e;
      }

      // Экспоненциальный backoff с jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = delay * 0.2 * Math.random(); // ±20% jitter
      const totalDelay = Math.round(delay + jitter);

      onRetry?.(attempt, e, totalDelay);
      await new Promise((r) => setTimeout(r, totalDelay));
    }
  }

  throw lastError;
}
