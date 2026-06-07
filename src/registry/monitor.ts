import { AgentDescriptor } from "../orchestrator/types.js";
import { Tracer } from "../services/observability/tracer.js";
import { CircuitBreakerRegistry, CircuitBreakerStats, CircuitState } from "../services/security/circuit-breaker.js";

/**
 * RegistryMonitor — мониторинг здоровья зарегистрированных агентов.
 *
 * Реализует Monitor Component из MS Reference Architecture (Agent Registry):
 * - Периодическая проверка liveness агентов
 * - Автоматический перевод в degraded при превышении error threshold
 * - Трекинг uptime, lastHealthCheck, error rate
 * - Интеграция с Tracer для observability
 * - Circuit Breaker: блокировка запросов к недоступным агентам (Threat Model — DoS mitigation)
 */

export interface AgentHealth {
  agentId: string;
  status: "active" | "degraded" | "inactive";
  lastHealthCheck: number;
  /** Количество последовательных failures */
  consecutiveFailures: number;
  /** Общее количество проверок */
  totalChecks: number;
  /** Общее количество failures */
  totalFailures: number;
  /** Uptime в мс (время с последнего перехода в active) */
  uptimeMs: number;
  /** Среднее время отклика мс */
  avgResponseMs: number;
  /** Последняя ошибка */
  lastError?: string;
}

export interface MonitorOptions {
  /** Интервал проверки в мс (по умолчанию 30000) */
  checkIntervalMs?: number;
  /** Максимум последовательных failures до degraded (по умолчанию 3) */
  maxConsecutiveFailures?: number;
  /** Максимум последовательных failures до inactive (по умолчанию 10) */
  maxTotalFailuresBeforeInactive?: number;
  /** Таймаут одного health check в мс (по умолчанию 5000) */
  healthCheckTimeoutMs?: number;
  /** Tracer для логирования */
  tracer?: Tracer;
  /** Включить circuit breaker (по умолчанию true) */
  enableCircuitBreaker?: boolean;
  /** Порог ошибок для circuit breaker trip (по умолчанию 5) */
  circuitBreakerFailureThreshold?: number;
  /** Таймаут восстановления circuit breaker в мс (по умолчанию 30000) */
  circuitBreakerRecoveryTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<Omit<MonitorOptions, "tracer">> = {
  checkIntervalMs: 30_000,
  maxConsecutiveFailures: 3,
  maxTotalFailuresBeforeInactive: 10,
  healthCheckTimeoutMs: 5_000,
  enableCircuitBreaker: true,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerRecoveryTimeoutMs: 30_000,
};

export class RegistryMonitor {
  private agents: Map<string, AgentDescriptor> = new Map();
  private health: Map<string, AgentHealth> = new Map();
  private options: Required<Omit<MonitorOptions, "tracer">> & { tracer?: Tracer };
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Circuit Breaker registry для блокировки запросов к недоступным агентам */
  private circuitBreaker: CircuitBreakerRegistry;

  constructor(options?: MonitorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.circuitBreaker = new CircuitBreakerRegistry({
      failureThreshold: this.options.circuitBreakerFailureThreshold,
      recoveryTimeoutMs: this.options.circuitBreakerRecoveryTimeoutMs,
    });
  }

  /**
   * Зарегистрировать агента для мониторинга.
   * Вызывается при registerAgent в Orchestrator.
   */
  registerAgent(agent: AgentDescriptor): void {
    this.agents.set(agent.id, agent);
    const now = Date.now();
    this.health.set(agent.id, {
      agentId: agent.id,
      status: agent.status ?? "active",
      lastHealthCheck: 0, // ещё не проверяли
      consecutiveFailures: 0,
      totalChecks: 0,
      totalFailures: 0,
      uptimeMs: now,
      avgResponseMs: 0,
    });
    this.options.tracer?.info("RegistryMonitor", "Agent registered for monitoring: " + agent.id, {
      agentId: agent.id,
    });
  }

  /**
   * Удалить агента из мониторинга.
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.health.delete(agentId);
    this.circuitBreaker.remove(agentId);
    this.options.tracer?.info("RegistryMonitor", "Agent unregistered from monitoring: " + agentId);
  }

  /**
   * Обновить статус агента (при ручном переключении).
   */
  setAgentStatus(agentId: string, status: "active" | "degraded" | "inactive"): void {
    const h = this.health.get(agentId);
    if (!h) return;
    const prevStatus = h.status;
    h.status = status;
    if (status === "active") {
      h.consecutiveFailures = 0;
      h.uptimeMs = Date.now();
    }
    this.options.tracer?.info("RegistryMonitor", "Agent status changed: " + agentId + " " + prevStatus + " -> " + status, {
      agentId,
      prevStatus,
      newStatus: status,
    });
  }

  /**
   * Записать результат вызова агента (для трекинга error rate).
   * Интегрирован с Circuit Breaker для автоматической блокировки недоступных агентов.
   */
  recordAgentCall(agentId: string, success: boolean, responseMs: number, error?: string): void {
    const h = this.health.get(agentId);
    if (!h) return;

    h.totalChecks++;
    h.lastHealthCheck = Date.now();

    // Обновляем avg response time (скользящее среднее)
    if (h.avgResponseMs === 0) {
      h.avgResponseMs = responseMs;
    } else {
      h.avgResponseMs = h.avgResponseMs * 0.7 + responseMs * 0.3;
    }

    if (success) {
      h.consecutiveFailures = 0;
      if (h.status === "degraded") {
        // Восстановление после degraded
        h.status = "active";
        h.uptimeMs = Date.now();
        this.options.tracer?.info("RegistryMonitor", "Agent recovered: " + agentId, { agentId });
      }
      // === Circuit Breaker: record success ===
      if (this.options.enableCircuitBreaker) {
        this.circuitBreaker.recordSuccess(agentId);
      }
    } else {
      h.totalFailures++;
      h.consecutiveFailures++;
      h.lastError = error;

      // === Circuit Breaker: record failure ===
      if (this.options.enableCircuitBreaker) {
        this.circuitBreaker.recordFailure(agentId);
        const cbState = this.circuitBreaker.getState(agentId);
        if (cbState === "open") {
          this.options.tracer?.warn("RegistryMonitor", "Circuit breaker OPEN for agent: " + agentId, {
            agentId,
            consecutiveFailures: h.consecutiveFailures,
          });
        }
      }

      // Автоматический перевод в degraded
      if (h.consecutiveFailures >= this.options.maxConsecutiveFailures && h.status === "active") {
        h.status = "degraded";
        this.options.tracer?.warn("RegistryMonitor", "Agent degraded: " + agentId + " (failures: " + h.consecutiveFailures + ")", {
          agentId,
          consecutiveFailures: h.consecutiveFailures,
          lastError: error,
        });
      }

      // Автоматический перевод в inactive
      if (h.consecutiveFailures >= this.options.maxTotalFailuresBeforeInactive) {
        h.status = "inactive";
        this.options.tracer?.error("RegistryMonitor", "Agent marked inactive: " + agentId + " (failures: " + h.consecutiveFailures + ")", {
          agentId,
          consecutiveFailures: h.consecutiveFailures,
          lastError: error,
        });
      }
    }
  }

  /**
   * Получить здоровье агента.
   */
  getAgentHealth(agentId: string): AgentHealth | undefined {
    return this.health.get(agentId);
  }

  /**
   * Получить здоровье всех агентов.
   */
  getAllHealth(): AgentHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * Получить только здоровых (active) агентов.
   */
  getHealthyAgents(): AgentHealth[] {
    return Array.from(this.health.values()).filter((h) => h.status === "active");
  }

  /**
   * Получить degraded/inactive агентов.
   */
  getUnhealthyAgents(): AgentHealth[] {
    return Array.from(this.health.values()).filter((h) => h.status !== "active");
  }

  /**
   * Запустить периодический мониторинг.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.runChecks(), this.options.checkIntervalMs);
    this.options.tracer?.info("RegistryMonitor", "Started (interval: " + this.options.checkIntervalMs + "ms)");
  }

  /**
   * Остановить периодический мониторинг.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.options.tracer?.info("RegistryMonitor", "Stopped");
  }

  /**
   * Запустить однократную проверку всех агентов.
   */
  async runChecks(): Promise<void> {
    const agentIds = Array.from(this.agents.keys());
    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId)!;
      await this.checkAgent(agentId, agent);
    }
  }

  /**
   * Проверить конкретного агента.
   * Для local agents — вызов handler с ping-запросом.
   * Для remote agents — HTTP ping (заглушка, расширяется).
   * Учитывает circuit breaker: если цепь открыта — проверка пропускается.
   */
  async checkAgent(agentId: string, agent: AgentDescriptor): Promise<boolean> {
    const h = this.health.get(agentId);
    if (!h) return false;

    // Пропускаем inactive агентов
    if (h.status === "inactive") return false;

    // === Circuit Breaker: skip if OPEN ===
    if (this.options.enableCircuitBreaker && !this.circuitBreaker.allowRequest(agentId)) {
      this.options.tracer?.debug("RegistryMonitor", "Circuit breaker blocking health check: " + agentId);
      return false;
    }

    const startTime = Date.now();
    try {
      // Health check: вызываем handler с пустым запросом
      // Для local agents это просто проверка что handler отвечает
      const timeout = this.options.healthCheckTimeoutMs;
      const result = await Promise.race([
        agent.handler({ id: "health-check", message: "ping", sessionId: "health" }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), timeout),
        ),
      ]);

      const responseMs = Date.now() - startTime;
      this.recordAgentCall(agentId, true, responseMs);
      return true;
    } catch (e: any) {
      const responseMs = Date.now() - startTime;
      this.recordAgentCall(agentId, false, responseMs, e.message);
      return false;
    }
  }

  /**
   * Экспорт состояния для дашборда.
   */
  exportStatus(): {
    totalAgents: number;
    healthy: number;
    degraded: number;
    inactive: number;
    agents: AgentHealth[];
    /** Circuit breaker состояния для каждого агента */
    circuitBreakers?: Record<string, CircuitBreakerStats>;
  } {
    const all = this.getAllHealth();
    const status: ReturnType<RegistryMonitor["exportStatus"]> = {
      totalAgents: all.length,
      healthy: all.filter((h) => h.status === "active").length,
      degraded: all.filter((h) => h.status === "degraded").length,
      inactive: all.filter((h) => h.status === "inactive").length,
      agents: all,
    };
    if (this.options.enableCircuitBreaker) {
      status.circuitBreakers = this.circuitBreaker.getAllStats();
    }
    return status;
  }

  // === Circuit Breaker Public API ===

  /**
   * Проверить, разрешён ли запрос к агенту (через circuit breaker).
   * Возвращает false если цепь открыта — запрос должен быть заблокирован.
   */
  isAgentAvailable(agentId: string): boolean {
    if (!this.options.enableCircuitBreaker) return true;
    return this.circuitBreaker.allowRequest(agentId);
  }

  /**
   * Получить circuit breaker состояние для агента.
   */
  getCircuitBreakerState(agentId: string): CircuitState {
    return this.circuitBreaker.getState(agentId);
  }

  /**
   * Получить circuit breaker статистику для агента.
   */
  getCircuitBreakerStats(agentId: string): CircuitBreakerStats {
    return this.circuitBreaker.getStats(agentId);
  }

  /**
   * Получить circuit breaker статистику для всех агентов.
   */
  getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
    return this.circuitBreaker.getAllStats();
  }

  /**
   * Принудительно сбросить circuit breaker для агента.
   */
  resetCircuitBreaker(agentId: string): void {
    this.circuitBreaker.getOrCreate(agentId).reset();
  }
}
