import { v4 as uuid } from "uuid";
import {
  AgentDescriptor,
  AgentRequest,
  AgentResponse,
  OrchestratorConfig,
} from "./types.js";
import { ConversationStore } from "../services/memory/index.js";
import { Tracer } from "../services/observability/index.js";

export class Orchestrator {
  private agents: Map<string, AgentDescriptor> = new Map();
  private config: OrchestratorConfig;
  private conversations: ConversationStore;
  private tracer: Tracer;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = {
      maxAgents: 10,
      defaultAgentId: "default",
      ...config,
    };
    this.conversations = new ConversationStore();
    this.tracer = new Tracer({ minLevel: "info", enableConsole: true });
  }

  registerAgent(agent: AgentDescriptor): void {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error("Agent limit reached");
    }
    this.agents.set(agent.id, agent);
    this.tracer.info("Orchestrator", "Agent registered: " + agent.id, { agentId: agent.id });
  }

  getAgent(id: string): AgentDescriptor | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentDescriptor[] {
    return [...this.agents.values()];
  }

  /**
   * Получить ConversationStore для интеграции с внешними компонентами
   */
  getConversations(): ConversationStore {
    return this.conversations;
  }

  /**
   * Получить Tracer для интеграции с внешними компонентами
   */
  getTracer(): Tracer {
    return this.tracer;
  }

  async handle(message: string, sessionId?: string): Promise<AgentResponse> {
    const sid = sessionId ?? "default";
    const traceId = this.tracer.startTrace("Orchestrator", "handle", { sessionId: sid });

    // Сохраняем сообщение пользователя в историю
    this.conversations.addMessage(sid, "user", message);

    const request: AgentRequest = {
      id: uuid(),
      message,
      sessionId: sid,
    };

    // Находим подходящего агента
    const agent = this.agents.get(this.config.defaultAgentId);
    if (!agent) {
      this.tracer.error("Orchestrator", "No default agent registered", { traceId });
      return {
        agentId: "none",
        content: "No default agent registered",
        confidence: 0,
      };
    }

    this.tracer.info("Orchestrator", "Delegating to agent: " + agent.id, { agentId: agent.id, traceId });

    const startTime = Date.now();
    try {
      const response = await agent.handler(request);
      const durationMs = Date.now() - startTime;

      // Сохраняем ответ агента в историю
      this.conversations.addMessage(sid, "assistant", response.content, { agentId: response.agentId });

      this.tracer.info("Orchestrator", "Agent response received", {
        agentId: response.agentId,
        durationMs,
        traceId,
      });

      return response;
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      this.tracer.error("Orchestrator", "Agent error: " + e.message, {
        agentId: agent.id,
        durationMs,
        traceId,
      });
      throw e;
    }
  }
}
