import { Box, Text, useApp, useInput } from "ink";
import type { ParsedCommand, ParsedMessage } from "../commands/parser.js";
import type { AgentHealth } from "../../registry/monitor.js";
import type { LogEntry } from "../../services/observability/tracer.js";

/**
 * Структура чата — одна запись.
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  agentId?: string;
}

/**
 * Событие трейсера для real-time отображения.
 */
export interface TraceEvent {
  type: "classification" | "agent_call" | "tool_call" | "error";
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Табы нижней панели.
 */
export type TabId = "chat" | "agents" | "metrics" | "sessions" | "logs";

/**
 * Состояние "загрузки" — какой агент/tool обрабатывает.
 */
export interface ProcessingState {
  active: boolean;
  agentId?: string;
  toolName?: string;
  toolCount: number;
  startTime: number;
}
