/**
 * Agent-to-Agent Communication (MS Reference Architecture: Pattern #9).
 *
 * Определяет единый формат сообщений между агентами и 3 паттерна коммуникации:
 * 1. Orchestrator-Mediated (через оркестратор)
 * 2. Direct A2A (прямой вызов с уведомлением оркестратора)
 * 3. Pub/Sub (через общее хранилище)
 */

import { AgentResponse } from "../orchestrator/types.js";

/**
 * Единый формат сообщения между агентами.
 * Содержит correlationId для трассировки цепочки вызовов.
 */
export interface AgentMessage {
  /** Уникальный ID сообщения */
  id: string;
  /** ID отправителя */
  fromAgentId: string;
  /** ID получателя (или "broadcast") */
  toAgentId: string;
  /** Тип сообщения */
  type: "request" | "response" | "event" | "query";
  /** Содержимое сообщения */
  payload: string;
  /** Correlation ID для трассировки (из исходного запроса) */
  correlationId: string;
  /** Timestamp создания */
  timestamp: number;
  /** Контекст вызова: session, user и т.д. */
  context?: {
    sessionId?: string;
    userId?: string;
    traceId?: string;
    [key: string]: unknown;
  };
}

/**
 * Результат межагентного вызова.
 */
export interface AgentCommunicationResult {
  success: boolean;
  response?: AgentResponse;
  error?: string;
  /** Время round-trip в мс */
  durationMs: number;
}

/**
 * Типы событий для Pub/Sub паттерна.
 */
export type AgentEvent =
  | { type: "agent_registered"; agentId: string }
  | { type: "agent_degraded"; agentId: string }
  | { type: "agent_call"; fromAgentId: string; toAgentId: string; correlationId: string }
  | { type: "agent_response"; fromAgentId: string; toAgentId: string; correlationId: string };

/**
 * Интерфейс Pub/Sub брокера для межагентной коммуникации.
 * Упрощённая in-memory реализация.
 */
export interface AgentEventBus {
  /** Подписаться на события конкретного агента */
  subscribe(agentId: string, handler: (event: AgentEvent) => void): () => void;
  /** Опубликовать событие */
  publish(event: AgentEvent): void;
  /** Получить историю событий для агента */
  getHistory(agentId: string): AgentEvent[];
}
