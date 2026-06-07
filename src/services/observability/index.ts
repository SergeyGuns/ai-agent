export { Tracer } from "./tracer.js";
export type { LogEntry, LogLevel, TracerOptions } from "./tracer.js";
export { Metrics } from "./metrics.js";
export type { AgentMetrics, ToolMetrics, SystemMetrics } from "./metrics.js";
export { ObservabilityService } from "./observability.service.js";

import { EventEmitter } from "node:events";
import type { LogLevel, LogEntry } from "./tracer.js";
import type { Tracer } from "./tracer.js";

/**
 * TracerEventEmitter — расширяет Tracer событиями для real-time TUI.
 * Эмитит события при каждом tool/agent call для live-обновления UI.
 */
export class TracerEventEmitter extends EventEmitter {
  private tracer: Tracer;

  constructor(tracer: Tracer) {
    super();
    this.tracer = tracer;
  }

  emitToolCall(params: {
    agentId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    durationMs: number;
    success: boolean;
    sessionId?: string;
    traceId?: string;
  }): void {
    this.tracer.logToolCall(params);
    this.emit("tool_call", params);
  }

  emitAgentCall(params: {
    agentId: string;
    input: string;
    output: string;
    durationMs: number;
    sessionId?: string;
    traceId?: string;
    agentVersion?: string;
  }): void {
    this.tracer.logAgentCall(params);
    this.emit("agent_call", params);
  }

  emitClassification(params: {
    intent: string;
    capability: string;
    confidence: number;
    method: string;
    traceId?: string;
  }): void {
    this.emit("classification", params);
  }

  emitError(params: {
    agentId?: string;
    error: string;
    traceId?: string;
  }): void {
    this.emit("error", params);
  }

  getEntries(): LogEntry[] {
    return this.tracer.getEntries();
  }

  getEntriesByLevel(level: LogLevel): LogEntry[] {
    return this.tracer.getEntriesByLevel(level);
  }

  getTrace(traceId: string): LogEntry[] {
    return this.tracer.getTrace(traceId);
  }

  export(): string {
    return this.tracer.export();
  }

  clear(): void {
    this.tracer.clear();
  }

  startTrace(component: string, message: string, data?: Record<string, unknown>): string {
    return this.tracer.startTrace(component, message, data);
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    this.tracer.info(component, message, data);
  }

  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this.tracer.warn(component, message, data);
  }

  error(component: string, message: string, data?: Record<string, unknown>): void {
    this.tracer.error(component, message, data);
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.tracer.debug(component, message, data);
  }
}
