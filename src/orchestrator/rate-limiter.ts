/**
 * SessionRateLimiter — per-session rate limiting для оркестратора.
 *
 * Реализует token bucket алгоритм (MS Reference Architecture: Threat Model — DoS mitigation).
 * Каждая сессия имеет свой bucket. При превышении лимита выбрасывает RateLimitError.
 */

export interface SessionRateLimiterOptions {
  /** Максимум запросов в секунду (по умолчанию 5) */
  requestsPerSecond?: number;
  /** Максимум токенов в bucket (burst capacity, по умолчанию 3) */
  maxBurst?: number;
  /** Максимум сессий в памяти (по умолчанию 1000). При превышении — удаляет самую старую. */
  maxSessions?: number;
}

interface SessionBucket {
  tokens: number;
  lastRefill: number;
  lastAccess: number;
}

export class RateLimitError extends Error {
  code: string;
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RateLimitError";
    this.code = "RATE_LIMIT_EXCEEDED";
    this.retryAfterMs = retryAfterMs;
  }
}

export class SessionRateLimiter {
  private buckets: Map<string, SessionBucket> = new Map();
  private readonly refillRate: number; // tokens per ms
  private readonly maxTokens: number;
  private readonly maxSessions: number;

  constructor(options?: SessionRateLimiterOptions) {
    const rps = options?.requestsPerSecond ?? 5;
    this.maxTokens = options?.maxBurst ?? 3;
    this.refillRate = rps / 1000;
    this.maxSessions = options?.maxSessions ?? 1000;
  }

  /**
   * Проверить и потребить токен для сессии.
   * Выбрасывает RateLimitError если токенов недостаточно.
   */
  acquire(sessionId: string): void {
    const now = Date.now();
    let bucket = this.buckets.get(sessionId);

    if (!bucket) {
      // Если сессий слишком много — удаляем самую старую
      if (this.buckets.size >= this.maxSessions) {
        this.evictOldest();
      }
      bucket = { tokens: this.maxTokens, lastRefill: now, lastAccess: now };
      this.buckets.set(sessionId, bucket);
    }

    // Рефилл токенов
    const elapsed = now - bucket.lastRefill;
    const newTokens = elapsed * this.refillRate;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + newTokens);
    bucket.lastRefill = now;
    bucket.lastAccess = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Нет токенов — считаем сколько ждать
    const waitMs = Math.ceil((1 - bucket.tokens) / this.refillRate);
    return;
  }

  /**
   * Проверить, есть ли доступный токен без потребления.
   * Возвращает { allowed, retryAfterMs }.
   */
  check(sessionId: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const bucket = this.buckets.get(sessionId);
    if (!bucket) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const elapsed = now - bucket.lastRefill;
    const tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);

    if (tokens >= 1) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const waitMs = Math.ceil((1 - tokens) / this.refillRate);
    return { allowed: false, retryAfterMs: waitMs };
  }

  /**
   * Сбросить лимит для сессии (при завершении диалога).
   */
  reset(sessionId: string): void {
    this.buckets.delete(sessionId);
  }

  /**
   * Получить количество отслеживаемых сессий.
   */
  get sessionCount(): number {
    return this.buckets.size;
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, bucket] of this.buckets) {
      if (bucket.lastAccess < oldestTime) {
        oldestTime = bucket.lastAccess;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.buckets.delete(oldestId);
    }
  }
}
