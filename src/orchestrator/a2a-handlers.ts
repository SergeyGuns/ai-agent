import { v4 as uuid } from "uuid";
import { AgentDescriptor, AgentRequest, AgentResponse } from "./types.js";
import {
  AgentMessage,
  AgentCommunicationResult,
  AgentEvent,
  AgentEventBus,
} from "./agent-communication.js";
import { Tracer } from "../services/observability/tracer.js";
import { ConversationStore } from "../services/memory/index.js";

/**
 * InMemoryAgentEventBus — упрощённый Pub/Sub брокер.
 *
 * Для production заменить на RabbitMQ/Kafka (MS Ref Arch: Message-Driven Communication).
 */
export class InMemoryAgentEventBus implements AgentEventBus {
  private subscribers: Map<string, Set<(event: AgentEvent) => void>> = new Map();
  private history: Map<string, AgentEvent[]> = new Map();
  private historyLimit = 100;

  subscribe(targetAgentId: string, handler: (event: AgentEvent) => void): () => void {
    if (!this.subscribers.has(targetAgentId)) {
      this.subscribers.set(targetAgentId, new Set());
    }
    this.subscribers.get(targetAgentId)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(targetAgentId)?.delete(handler);
    };
  }

  publish(event: AgentEvent): void {
    // Store in history
    const agentId = this.getAgentIdFromEvent(event);
    if (agentId) {
      if (!this.history.has(agentId)) {
        this.history.set(agentId, []);
      }
      const h = this.history.get(agentId)!;
      h.push(event);
      if (h.length > this.historyLimit) {
        h.splice(0, h.length - this.historyLimit);
      }
    }

    // Notify subscribers
    if (agentId && this.subscribers.has(agentId)) {
      const handlers = Array.from(this.subscribers.get(agentId)!);
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // ignore handler errors
        }
      }
    }
  }

  getHistory(agentId: string): AgentEvent[] {
    return this.history.get(agentId) ?? [];
  }

  private getAgentIdFromEvent(event: AgentEvent): string | null {
    switch (event.type) {
      case "agent_registered":
      case "agent_degraded":
        return event.agentId;
      case "agent_call":
      case "agent_response":
        return event.toAgentId;
      default:
        return null;
    }
  }
}

/**
 * Функция-фабрика для создания AgentCommunicationMixin.
 * Добавляет методы A2A в Orchestrator.
 */
export function createA2AHandlers(
  agents: Map<string, AgentDescriptor>,
  tracer: Tracer,
  conversations: ConversationStore,
  monitor: { recordAgentCall: (agentId: string, success: boolean, responseMs: number, error?: string) => void },
  eventBus: InMemoryAgentEventBus,
) {
  /**
   * Отправить сообщение от одного агента к другому (Orchestrator-Mediated).
   * Паттерн #9.1: оркестратор маршрутизирует сообщение.
   */
  function sendMessage(
    fromAgentId: string,
    toAgentId: string,
    payload: string,
    correlationId: string,
    sessionId?: string,
  ): Promise<AgentCommunicationResult> {
    const startTime = Date.now();

    tracer.info("AgentCommunication", "A2A message: " + fromAgentId + " -> " + toAgentId, {
      fromAgentId,
      toAgentId,
      correlationId,
      sessionId,
    });

    // Publish event
    eventBus.publish({
      type: "agent_call",
      fromAgentId,
      toAgentId,
      correlationId,
    });

    const targetAgent = agents.get(toAgentId);
    if (!targetAgent) {
      const error = "Target agent not found: " + toAgentId;
      tracer.warn("AgentCommunication", error, { toAgentId, correlationId });
      return Promise.resolve({
        success: false,
        error,
        durationMs: Date.now() - startTime,
      });
    }

    const request: AgentRequest = {
      id: uuid(),
      message: payload,
      sessionId: sessionId || correlationId,
    };

    return targetAgent.handler(request)
      .then((response) => {
        const durationMs = Date.now() - startTime;

        // Record in monitor
        monitor.recordAgentCall(toAgentId, true, durationMs);

        // Store inter-agent message in conversation history
        if (sessionId) {
          conversations.addMessage(sessionId, "assistant", "[A2A " + fromAgentId + " -> " + toAgentId + "] " + response.content, {
            agentId: toAgentId,
          });
        }

        // Publish response event
        eventBus.publish({
          type: "agent_response",
          fromAgentId: toAgentId,
          toAgentId: fromAgentId,
          correlationId,
        });

        tracer.info("AgentCommunication", "A2A response: " + toAgentId + " -> " + fromAgentId, {
          fromAgentId,
          toAgentId,
          durationMs,
          correlationId,
        });

        return { success: true, response, durationMs };
      })
      .catch((e: Error) => {
        const durationMs = Date.now() - startTime;
        monitor.recordAgentCall(toAgentId, false, durationMs, e.message);

        tracer.error("AgentCommunication", "A2A error: " + e.message, {
          fromAgentId,
          toAgentId,
          correlationId,
        });

        return {
          success: false,
          error: e.message,
          durationMs,
        };
      });
  }

  /**
   * Broadcast — отправить сообщение всем агентам с данной capability (Pub/Sub).
   * Паттерн #9.3.
   */
  async function broadcastToCapability(
    fromAgentId: string,
    capability: string,
    payload: string,
    correlationId: string,
  ): Promise<AgentCommunicationResult[]> {
    const results: AgentCommunicationResult[] = [];
    const agentIds: string[] = [];

    for (const agentEntry of Array.from(agents.entries())) {
      const id = agentEntry[0];
      const agent = agentEntry[1];
      if (id !== fromAgentId && agent.capabilities.includes(capability) && agent.status !== "inactive") {
        agentIds.push(id);
      }
    }

    tracer.info("AgentCommunication", "Broadcasting to " + agentIds.length + " agents with capability: " + capability, {
      fromAgentId,
      capability,
      targetAgents: agentIds,
      correlationId,
    });

    // Fan-out: параллельный вызов всех подходящих агентов
    const promises = agentIds.map((id) =>
      sendMessage(fromAgentId, id, payload, correlationId)
    );

    return Promise.all(promises);
  }

  /**
   * Создать AgentMessage из текущего контекста.
   */
  function createAgentMessage(
    fromAgentId: string,
    toAgentId: string,
    payload: string,
    correlationId: string,
    context?: AgentMessage["context"],
  ): AgentMessage {
    return {
      id: uuid(),
      fromAgentId,
      toAgentId,
      type: "request",
      payload,
      correlationId,
      timestamp: Date.now(),
      context,
    };
  }

  return {
    sendMessage,
    broadcastToCapability,
    createAgentMessage,
  };
}

export type A2AHandlers = ReturnType<typeof createA2AHandlers>;
