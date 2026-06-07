/**
 * Circuit Breaker для мультиагентной системы.
 *
 * Реализует паттерн Circuit Breaker (MS Reference Architecture: Threat Model — DoS mitigation):
 * - CLOSED: нормальная работа, запросы проходят
 * - OPEN: агент недоступен, запросы блокируются мгновенно
 * - HALF_OPEN: пробный запрос для проверки восстановления
 *
 * Переходы:
 * - CLOSED → OPEN: при consecutiveFailures >= failureThreshold
 * - OPEN → HALF_OPEN: через recoveryTimeoutMs
 * - HALF_OPEN → CLOSED: при успешном пробном запросе
 * - HALF_OPEN → OPEN: при неудачном пробном запросе
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Порог последовательных ошибок для перехода в OPEN (по умолчанию 5) */
  failureThreshold?: number;
  /** Таймаут восстановления в мс (по умолчанию 30000) */
  recoveryTimeoutMs?: number;
  /** Минимальное количество запросов перед переходом в OPEN (по умолчанию 3) */
  minRequestsBeforeTrip?: number;
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  minRequestsBeforeTrip: 3,
};

export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  openedAt: number | null;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private openedAt: number | null = null;
  private options: Required<CircuitBreakerOptions>;

  constructor(options?: CircuitBreakerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Проверить, можно ли выполнить запрос.
   * Возвращает true если запрос разрешён (CLOSED или HALF_OPEN).
   */
  allowRequest(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      // Проверяем, прошло ли достаточно времени для HALF_OPEN
      if (this.openedAt && Date.now() - this.openedAt >= this.options.recoveryTimeoutMs) {
        this.transitionTo("half-open");
        return true;
      }
      return false;
    }

    // half-open: разрешаем один пробный запрос
    return true;
  }

  /**
   * Записать успешный запрос.
   */
  recordSuccess(): void {
    this.totalRequests++;
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;

    if (this.state === "half-open") {
      this.transitionTo("closed");
    }
  }

  /**
   * Записать неудачный запрос.
   */
  recordFailure(): void {
    this.totalRequests++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;

    if (this.state === "half-open") {
      this.transitionTo("open");
      return;
    }

    if (this.state === "closed") {
      // Переходим в OPEN только если достаточно запросов и ошибок
      if (
        this.totalRequests >= this.options.minRequestsBeforeTrip &&
        this.consecutiveFailures >= this.options.failureThreshold
      ) {
        this.transitionTo("open");
      }
    }
  }

  /**
   * Принудительно открыть цепь.
   */
  trip(): void {
    this.transitionTo("open");
  }

  /**
   * Принудительно закрыть цепь.
   */
  reset(): void {
    this.transitionTo("closed");
    this.consecutiveFailures = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
  }

  /**
   * Получить текущее состояние.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Получить статистику.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      openedAt: this.openedAt,
    };
  }

  private transitionTo(newState: CircuitState): void {
    const prevState = this.state;
    this.state = newState;

    if (newState === "open") {
      this.openedAt = Date.now();
    } else if (newState === "closed") {
      this.openedAt = null;
      this.consecutiveFailures = 0;
    }
  }
}

/**
 * CircuitBreakerRegistry — управление circuit breakers для множества агентов.
 * Хранит по одному CircuitBreaker на агента.
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private options: Required<CircuitBreakerOptions>;

  constructor(options?: CircuitBreakerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Получить или создать circuit breaker для агента.
   */
  getOrCreate(agentId: string): CircuitBreaker {
    let breaker = this.breakers.get(agentId);
    if (!breaker) {
      breaker = new CircuitBreaker(this.options);
      this.breakers.set(agentId, breaker);
    }
    return breaker;
  }

  /**
   * Проверить, можно ли выполнить запрос к агенту.
   */
  allowRequest(agentId: string): boolean {
    return this.getOrCreate(agentId).allowRequest();
  }

  /**
   * Записать успешный вызов агента.
   */
  recordSuccess(agentId: string): void {
    this.getOrCreate(agentId).recordSuccess();
  }

  /**
   * Записать неудачный вызов агента.
   */
  recordFailure(agentId: string): void {
    this.getOrCreate(agentId).recordFailure();
  }

  /**
   * Получить состояние circuit breaker для агента.
   */
  getState(agentId: string): CircuitState {
    return this.getOrCreate(agentId).getState();
  }

  /**
   * Получить статистику для агента.
   */
  getStats(agentId: string): CircuitBreakerStats {
    return this.getOrCreate(agentId).getStats();
  }

  /**
   * Получить статистику для всех агентов.
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const result: Record<string, CircuitBreakerStats> = {};
    for (const [id, breaker] of Array.from(this.breakers.entries())) {
      result[id] = breaker.getStats();
    }
    return result;
  }

  /**
   * Удалить circuit breaker для агента.
   */
  remove(agentId: string): void {
    this.breakers.delete(agentId);
  }

  /**
   * Сбросить все circuit breakers.
   */
  resetAll(): void {
    for (const breaker of Array.from(this.breakers.values())) {
      breaker.reset();
    }
  }
}
