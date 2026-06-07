export interface AgentMetrics {
  agentId: string;
  calls: number;
  totalDurationMs: number;
  errors: number;
  tokensUsed: number;
  tokensGenerated: number;
  /** Метрики по версиям: version → { calls, errors, totalDurationMs } */
  versions: Map<string, { calls: number; errors: number; totalDurationMs: number }>;
}

export interface ToolMetrics {
  toolName: string;
  calls: number;
  totalDurationMs: number;
  errors: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface SystemMetrics {
  totalRequests: number;
  totalErrors: number;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalTokensGenerated: number;
  activeSessions: number;
  uptimeMs: number;
}

/**
 * Metrics — сбор и агрегация метрик мультиагентной системы.
 *
 * Метрики:
 * - Agent calls: количество, длительность, ошибки
 * - Tool calls: количество, длительность, ошибки по каждому tool
 * - System: общее количество запросов, ошибок, токенов
 */
export class Metrics {
  private agentMetrics: Map<string, AgentMetrics> = new Map();
  private toolMetrics: Map<string, ToolMetrics> = new Map();
  private startTime = Date.now();
  private totalRequests = 0;
  private totalErrors = 0;
  private totalDurationMs = 0;

  /**
   * Записать вызов агента
   */
  recordAgentCall(agentId: string, durationMs: number, tokensUsed: number, tokensGenerated: number, error?: boolean): void {
    let m = this.agentMetrics.get(agentId);
    if (!m) {
      m = { agentId, calls: 0, totalDurationMs: 0, errors: 0, tokensUsed: 0, tokensGenerated: 0, versions: new Map() };
      this.agentMetrics.set(agentId, m);
    }
    m.calls++;
    m.totalDurationMs += durationMs;
    m.tokensUsed += tokensUsed;
    m.tokensGenerated += tokensGenerated;
    if (error) m.errors++;

    this.totalRequests++;
    this.totalDurationMs += durationMs;
    if (error) this.totalErrors++;
  }

  /**
   * Записать вызов агента с указанием версии (для canary/A-B comparison).
   */
  recordAgentCallWithVersion(
    agentId: string,
    agentVersion: string,
    durationMs: number,
    tokensUsed: number,
    tokensGenerated: number,
    error?: boolean,
  ): void {
    // Update base metrics
    this.recordAgentCall(agentId, durationMs, tokensUsed, tokensGenerated, error);

    // Update version-specific metrics
    const m = this.agentMetrics.get(agentId);
    if (!m) return;

    let v = m.versions.get(agentVersion);
    if (!v) {
      v = { calls: 0, errors: 0, totalDurationMs: 0 };
      m.versions.set(agentVersion, v);
    }
    v.calls++;
    v.totalDurationMs += durationMs;
    if (error) v.errors++;
  }

  /**
   * Получить метрики по версии агента.
   */
  getVersionMetrics(agentId: string, agentVersion: string): { calls: number; errors: number; avgDurationMs: number; errorRate: number } | undefined {
    const m = this.agentMetrics.get(agentId);
    if (!m) return undefined;
    const v = m.versions.get(agentVersion);
    if (!v) return undefined;
    return {
      calls: v.calls,
      errors: v.errors,
      avgDurationMs: v.calls > 0 ? v.totalDurationMs / v.calls : 0,
      errorRate: v.calls > 0 ? v.errors / v.calls : 0,
    };
  }

  /**
   * Сравнить метрики двух версий агента (для canary/shadow analysis).
   * Возвращает сравнение error rate и avg duration.
   */
  compareVersions(
    agentId: string,
    versionA: string,
    versionB: string,
  ): {
    versionA: { calls: number; errorRate: number; avgDurationMs: number };
    versionB: { calls: number; errorRate: number; avgDurationMs: number };
    deltaErrorRate: number; // positive = B is worse
    deltaAvgDurationMs: number; // positive = B is slower
  } | undefined {
    const a = this.getVersionMetrics(agentId, versionA);
    const b = this.getVersionMetrics(agentId, versionB);
    if (!a || !b) return undefined;
    return {
      versionA: a,
      versionB: b,
      deltaErrorRate: b.errorRate - a.errorRate,
      deltaAvgDurationMs: b.avgDurationMs - a.avgDurationMs,
    };
  }

  /**
   * Записать вызов инструмента
   */
  recordToolCall(toolName: string, durationMs: number, error?: boolean): void {
    let m = this.toolMetrics.get(toolName);
    if (!m) {
      m = { toolName, calls: 0, totalDurationMs: 0, errors: 0, avgDurationMs: 0, maxDurationMs: 0 };
      this.toolMetrics.set(toolName, m);
    }
    m.calls++;
    m.totalDurationMs += durationMs;
    m.avgDurationMs = m.totalDurationMs / m.calls;
    m.maxDurationMs = Math.max(m.maxDurationMs, durationMs);
    if (error) m.errors++;
  }

  /**
   * Получить метрики агента
   */
  getAgentMetrics(agentId: string): AgentMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  /**
   * Получить метрики инструмента
   */
  getToolMetrics(toolName: string): ToolMetrics | undefined {
    return this.toolMetrics.get(toolName);
  }

  /**
   * Получить все метрики агентов
   */
  getAllAgentMetrics(): AgentMetrics[] {
    return [...this.agentMetrics.values()];
  }

  /**
   * Получить все метрики инструментов
   */
  getAllToolMetrics(): ToolMetrics[] {
    return [...this.toolMetrics.values()];
  }

  /**
   * Получить системные метрики
   */
  getSystemMetrics(activeSessions = 0): SystemMetrics {
    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      totalDurationMs: this.totalDurationMs,
      totalTokensUsed: [...this.agentMetrics.values()].reduce((s, m) => s + m.tokensUsed, 0),
      totalTokensGenerated: [...this.agentMetrics.values()].reduce((s, m) => s + m.tokensGenerated, 0),
      activeSessions,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  /**
   * Экспорт всех метрик в JSON
   */
  export(activeSessions = 0): string {
    return JSON.stringify(
      {
        system: this.getSystemMetrics(activeSessions),
        agents: this.getAllAgentMetrics(),
        tools: this.getAllToolMetrics(),
      },
      null,
      2
    );
  }

  /**
   * Сброс всех метрик
   */
  reset(): void {
    this.agentMetrics.clear();
    this.toolMetrics.clear();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalDurationMs = 0;
    this.startTime = Date.now();
  }
}
