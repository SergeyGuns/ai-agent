import { Tracer, LogEntry, LogLevel, TracerOptions } from "./tracer.js";
import { Metrics, AgentMetrics, ToolMetrics, SystemMetrics } from "./metrics.js";

/**
 * ObservabilityService — интегрированная observability для мультиагентной системы.
 *
 * Объединяет Tracer и Metrics в единый сервис.
 * Поддерживает экспорт в OpenTelemetry JSON формат.
 *
 * Реализует Evaluation-Driven Observability (MS Reference Architecture):
 * - Автоматический сбор metrics при каждом tool/agent call
 * - Correlation между traces и metrics
 * - Экспорт для анализа производительности
 */
export class ObservabilityService {
  readonly tracer: Tracer;
  readonly metrics: Metrics;

  constructor(options?: { tracer?: TracerOptions }) {
    this.tracer = new Tracer(options?.tracer);
    this.metrics = new Metrics();
  }

  /**
   * Логировать tool call и автоматически обновить metrics
   */
  logToolCall(params: {
    agentId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    durationMs: number;
    success: boolean;
    sessionId?: string;
    traceId?: string;
  }): void {
    // Логируем в tracer
    this.tracer.logToolCall(params);

    // Автоматически обновляем metrics
    this.metrics.recordToolCall(params.toolName, params.durationMs, !params.success);
  }

  /**
   * Логировать agent call и автоматически обновить metrics
   */
  logAgentCall(params: {
    agentId: string;
    input: string;
    output: string;
    durationMs: number;
    tokensUsed?: number;
    tokensGenerated?: number;
    sessionId?: string;
    traceId?: string;
    error?: boolean;
  }): void {
    // Логируем в tracer
    this.tracer.logAgentCall(params);

    // Автоматически обновляем metrics
    this.metrics.recordAgentCall(
      params.agentId,
      params.durationMs,
      params.tokensUsed ?? 0,
      params.tokensGenerated ?? 0,
      params.error,
    );
  }

  /**
   * Экспорт в OpenTelemetry JSON формат
   * https://opentelemetry.io/docs/specs/otel/trace/api/
   */
  exportToOpenTelemetry(activeSessions = 0): string {
    const entries = this.tracer.getEntries();
    const systemMetrics = this.metrics.getSystemMetrics(activeSessions);
    const agentMetrics = this.metrics.getAllAgentMetrics();
    const toolMetrics = this.metrics.getAllToolMetrics();

    // Группируем entries по traceId
    const traces = new Map<string, LogEntry[]>();
    for (const entry of entries) {
      const traceId = entry.traceId || "no-trace";
      if (!traces.has(traceId)) {
        traces.set(traceId, []);
      }
      traces.get(traceId)!.push(entry);
    }

    // Конвертируем в OTel формат
    const otelTraces: object[] = [];
    for (const [traceId, traceEntries] of traces) {
      const spans = traceEntries.map((entry) => ({
        traceId,
        spanId: `${entry.timestamp}-${entry.component}`,
        name: entry.message,
        kind: "SPAN_KIND_INTERNAL",
        startTimeUnixNano: entry.timestamp * 1_000_000,
        endTimeUnixNano: (entry.durationMs
          ? entry.timestamp + entry.durationMs
          : entry.timestamp + 1) * 1_000_000,
        attributes: [
          { key: "component", value: { stringValue: entry.component } },
          { key: "level", value: { stringValue: entry.level } },
          ...(entry.agentId
            ? [{ key: "agent.id", value: { stringValue: entry.agentId } }]
            : []),
          ...(entry.sessionId
            ? [{ key: "session.id", value: { stringValue: entry.sessionId } }]
            : []),
          ...(entry.data
            ? [
                {
                  key: "data",
                  value: { stringValue: JSON.stringify(entry.data) },
                },
              ]
            : []),
        ],
      }));

      otelTraces.push({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "ai-agent" } },
                {
                  key: "service.version",
                  value: { stringValue: "2.0.0" },
                },
              ],
            },
            scopeSpans: [
              {
                spans,
              },
            ],
          },
        ],
      });
    }

    return JSON.stringify(
      {
        resourceSpans: otelTraces,
        metrics: {
          system: systemMetrics,
          agents: agentMetrics,
          tools: toolMetrics,
        },
      },
      null,
      2,
    );
  }

  /**
   * Получить сводку для дашборда
   */
  getDashboardSummary(activeSessions = 0): {
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
    avgDurationMs: number;
    activeSessions: number;
    topAgents: { agentId: string; calls: number; errors: number }[];
    topTools: { toolName: string; calls: number; avgDurationMs: number }[];
    recentErrors: LogEntry[];
  } {
    const sys = this.metrics.getSystemMetrics(activeSessions);
    const agentMetrics = this.metrics.getAllAgentMetrics();
    const toolMetrics = this.metrics.getAllToolMetrics();
    const recentErrors = this.tracer.getEntriesByLevel("error").slice(-10);

    return {
      totalRequests: sys.totalRequests,
      totalErrors: sys.totalErrors,
      errorRate: sys.totalRequests > 0 ? sys.totalErrors / sys.totalRequests : 0,
      avgDurationMs: sys.totalRequests > 0 ? sys.totalDurationMs / sys.totalRequests : 0,
      activeSessions: sys.activeSessions,
      topAgents: agentMetrics
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 5)
        .map((a) => ({
          agentId: a.agentId,
          calls: a.calls,
          errors: a.errors,
        })),
      topTools: toolMetrics
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 5)
        .map((t) => ({
          toolName: t.toolName,
          calls: t.calls,
          avgDurationMs: t.avgDurationMs,
        })),
      recentErrors,
    };
  }

  /**
   * Очистить все данные
   */
  clear(): void {
    this.tracer.clear();
    this.metrics.reset();
  }
}
