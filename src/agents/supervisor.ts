import { Agent } from "../services/ai/agent.js";
import { Orchestrator } from "../orchestrator/index.js";
import { classify } from "../orchestrator/classifier.js";
import { loadRegistry } from "../registry/registry.js";
import { WebResearchAgent } from "./web-research/agent.js";
import { ConversationStore } from "../services/memory/index.js";
import { Tracer } from "../services/observability/tracer.js";
import { Metrics } from "../services/observability/metrics.js";
import type { AgentDescriptor, AgentRequest, AgentResponse } from "../orchestrator/types.js";

export class SupervisorAgent {
  private orchestrator: Orchestrator;
  private registry;
  private codeAgent: Agent;
  private webAgent: WebResearchAgent;
  private conversations: ConversationStore;
  private tracer: Tracer;
  private metrics: Metrics;

  constructor(workspaceRoot?: string) {
    this.registry = loadRegistry();
    this.orchestrator = new Orchestrator({ defaultAgentId: "general-agent" });
    this.conversations = this.orchestrator.getConversations();
    this.tracer = this.orchestrator.getTracer();
    this.metrics = new Metrics();

    // Создаём агентов
    this.codeAgent = new Agent({
      maxIterations: 999,
      systemPrompt: "Ты — AI-ассистент для работы с кодом. Используй инструменты.",
      workspaceRoot: workspaceRoot || process.cwd(),
    });
    this.codeAgent.setTracer(this.tracer);
    this.codeAgent.setMetrics(this.metrics);

    this.webAgent = new WebResearchAgent();

    // Регистрируем всех агентов из реестра
    for (const descriptor of this.registry) {
      const desc: AgentDescriptor = {
        ...descriptor,
        handler: async (req: AgentRequest): Promise<AgentResponse> => {
          const startTime = Date.now();
          let result: string;
          let error = false;

          try {
            if (descriptor.id === "web-research-agent") {
              const researchResult = await this.webAgent.research(req.message);
              result = researchResult.summary;
            } else {
              result = await this.codeAgent.process(req.message);
            }
          } catch (e: any) {
            result = "Error: " + e.message;
            error = true;
          }

          const durationMs = Date.now() - startTime;

          // Трейсинг и метрики
          this.tracer.logAgentCall({
            agentId: descriptor.id,
            input: req.message,
            output: result,
            durationMs,
            sessionId: req.sessionId,
          });
          this.metrics.recordAgentCall(descriptor.id, durationMs, 0, 0, error);

          return {
            agentId: descriptor.id,
            content: result,
            confidence: 1,
          };
        },
      };
      this.orchestrator.registerAgent(desc);
    }
  }

  async handle(message: string, sessionId?: string): Promise<string> {
    const sid = sessionId ?? "session-" + Date.now();
    const { intent, confidence } = classify(message);
    this.tracer.info("Supervisor", "Classified intent: " + intent, { intent, confidence, sessionId: sid });

    // Находим подходящего агента
    const agent = this.orchestrator.listAgents().find((a) =>
      a.capabilities.includes(intent),
    );

    const agentId = agent?.id ?? "general-agent";
    this.tracer.info("Supervisor", "Selected agent: " + agentId, { agentId, sessionId: sid });

    const response = await this.orchestrator.handle(message, sid);
    return response.content;
  }

  /**
   * Получить историю сообщений сессии
   */
  getConversationHistory(sessionId: string) {
    return this.conversations.getMessages(sessionId);
  }

  /**
   * Получить все активные сессии
   */
  listSessions() {
    return this.conversations.listSessions();
  }

  /**
   * Очистить сессию
   */
  clearSession(sessionId: string): void {
    this.conversations.clearSession(sessionId);
  }

  /**
   * Получить метрики системы
   */
  getMetrics(): string {
    return this.metrics.export(this.conversations.sessionCount);
  }

  /**
   * Получить все логи трейсера
   */
  getLogs(): string {
    return this.tracer.export();
  }

  /**
   * Получить записи трейса по ID
   */
  getTrace(traceId: string) {
    return this.tracer.getTrace(traceId);
  }
}
