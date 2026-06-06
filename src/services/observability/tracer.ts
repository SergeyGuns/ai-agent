export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
  sessionId?: string;
  agentId?: string;
  durationMs?: number;
}

export interface TracerOptions {
  minLevel?: LogLevel;
  enableConsole?: boolean;
  logFilePath?: string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Tracer — структурированное логирование для мультиагентной системы.
 *
 * Каждая запись содержит:
 * - timestamp, level, component, message
 * - опционально: traceId (цепочка вызовов), sessionId (сессия пользователя), agentId
 * - опционально: durationMs (длительность операции)
 *
 * Поддерживает фильтрацию по уровню и запись в файл.
 */
export class Tracer {
  private entries: LogEntry[] = [];
  private options: Required<TracerOptions>;
  private traceCounter = 0;

  constructor(options?: TracerOptions) {
    this.options = {
      minLevel: options?.minLevel ?? "info",
      enableConsole: options?.enableConsole ?? true,
      logFilePath: options?.logFilePath ?? "",
    };
  }

  /**
   * Начать новый трейс. Возвращает traceId для связывания записей.
   */
  startTrace(component: string, message: string, data?: Record<string, unknown>): string {
    const traceId = "trace-" + (++this.traceCounter) + "-" + Date.now();
    this.log("info", component, message, { ...data, traceId });
    return traceId;
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.log("debug", component, message, data);
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    this.log("info", component, message, data);
  }

  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this.log("warn", component, message, data);
  }

  error(component: string, message: string, data?: Record<string, unknown>): void {
    this.log("error", component, message, data);
  }

  /**
   * Логировать вызов инструмента
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
    const level: LogLevel = params.success ? "info" : "warn";
    this.log(level, "ToolCall", params.toolName, {
      agentId: params.agentId,
      toolName: params.toolName,
      args: params.args,
      resultPreview: params.result.slice(0, 200),
      durationMs: params.durationMs,
      success: params.success,
      sessionId: params.sessionId,
      traceId: params.traceId,
    });
  }

  /**
   * Логировать вызов агента
   */
  logAgentCall(params: {
    agentId: string;
    input: string;
    output: string;
    durationMs: number;
    sessionId?: string;
    traceId?: string;
  }): void {
    this.log("info", "AgentCall", params.agentId, {
      agentId: params.agentId,
      inputPreview: params.input.slice(0, 100),
      outputPreview: params.output.slice(0, 200),
      durationMs: params.durationMs,
      sessionId: params.sessionId,
      traceId: params.traceId,
    });
  }

  /**
   * Получить все записи
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Получить записи по уровню
   */
  getEntriesByLevel(level: LogLevel): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }

  /**
   * Получить записи по traceId
   */
  getTrace(traceId: string): LogEntry[] {
    return this.entries.filter((e) => e.traceId === traceId);
  }

  /**
   * Экспорт в JSON
   */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Очистить записи
   */
  clear(): void {
    this.entries = [];
  }

  private log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.options.minLevel]) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message,
      data,
      traceId: data?.traceId as string | undefined,
      sessionId: data?.sessionId as string | undefined,
      agentId: data?.agentId as string | undefined,
      durationMs: data?.durationMs as number | undefined,
    };

    this.entries.push(entry);

    if (this.options.enableConsole) {
      const ts = new Date(entry.timestamp).toISOString();
      const prefix = "[" + ts + " " + level.toUpperCase() + "] [" + component + "]";
      const dataStr = data ? " " + JSON.stringify(data) : "";
      const line = prefix + " " + message + dataStr;

      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  }
}
