import { Agent } from "../services/ai/agent.js";
import { Orchestrator } from "../orchestrator/index.js";
import { loadRegistry } from "../registry/registry.js";
import { WebResearchAgent } from "./web-research/agent.js";
import { CommandAgent } from "./command/agent.js";
import { ConversationStore } from "../services/memory/index.js";
import { Tracer } from "../services/observability/tracer.js";
import { Metrics } from "../services/observability/metrics.js";
import { RBACService, AuditLog } from "../services/security/index.js";
import { EvaluationService } from "../services/evaluation/service.js";
import { withEvaluation, EvaluationMiddleware, runOfflineEvaluation } from "../services/evaluation/middleware.js";
import type { AgentDescriptor, AgentRequest, AgentResponse } from "../orchestrator/types.js";

export class SupervisorAgent {
  private orchestrator: Orchestrator;
  private registry;
  private codeAgent: Agent;
  private webAgent: WebResearchAgent;
  private commandAgent: CommandAgent;
  private conversations: ConversationStore;
  private tracer: Tracer;
  private metrics: Metrics;
  private rbac: RBACService;
  private auditLog: AuditLog;

  constructor(workspaceRoot?: string) {
    this.registry = loadRegistry();
    this.orchestrator = new Orchestrator({ defaultAgentId: "general-agent" });
    this.conversations = this.orchestrator.getConversations();
    this.tracer = this.orchestrator.getTracer();
    this.metrics = new Metrics();

    // Инициализация RBAC и Audit Log
    this.rbac = new RBACService();
    this.auditLog = new AuditLog();

    // Устанавливаем роли агентам на основе их capabilities
    for (const descriptor of this.registry) {
      const role = this.inferRole(descriptor.capabilities);
      this.rbac.setAgentRole(descriptor.id, role);
    }

    // Создаём агентов с RBAC и AuditLog
    this.codeAgent = new Agent({
      maxIterations: 999,
      systemPrompt: "Ты — AI-ассистент для работы с кодом. Используй инструменты.",
      workspaceRoot: workspaceRoot || process.cwd(),
      agentId: "code-agent",
      rbac: this.rbac,
      auditLog: this.auditLog,
    });
    this.codeAgent.setTracer(this.tracer);
    this.codeAgent.setMetrics(this.metrics);

    this.webAgent = new WebResearchAgent();
    this.commandAgent = new CommandAgent(workspaceRoot);

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
            } else if (descriptor.id === "command-agent") {
              result = await this.commandAgent.execute(req.message);
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
            agentVersion: descriptor.version,
          });
          this.metrics.recordAgentCallWithVersion(
            descriptor.id,
            descriptor.version ?? "unknown",
            durationMs,
            0,
            0,
            error,
          );

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

  /**
   * Определить роль агента на основе его capabilities
   */
  private inferRole(capabilities: string[]): "admin" | "developer" | "researcher" | "readonly" {
    if (capabilities.includes("general")) return "readonly";
    if (capabilities.some((c) => ["command-exec", "shell", "devops"].includes(c))) {
      return "admin";
    }
    if (capabilities.some((c) => ["web-search", "web-scrape", "browser", "fact-check"].includes(c))) {
      return "researcher";
    }
    if (capabilities.some((c) => ["code-search", "file-read", "file-list"].includes(c))) {
      return "developer";
    }
    return "readonly";
  }

  async handle(message: string, sessionId?: string): Promise<string> {
    const sid = sessionId ?? "session-" + Date.now();

    // Единая классификация через Orchestrator (убрана двойная)
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

  /**
   * Получить audit log
   */
  getAuditLog(): string {
    return this.auditLog.export();
  }

  /**
   * Получить отклонённые вызовы из audit log
   */
  getDeniedCalls() {
    return this.auditLog.getDeniedEntries();
  }

  /**
   * Получить RBAC сервис (для настройки ролей во время выполнения)
   */
  getRBAC(): RBACService {
    return this.rbac;
  }
}
