import { v4 as uuid } from "uuid";
import {
  AgentDescriptor,
  AgentRequest,
  AgentResponse,
  AgentRole,
  OrchestratorConfig,
} from "./types.js";
import { ConversationStore } from "../services/memory/index.js";
import { Tracer } from "../services/observability/index.js";
import { SemanticRouter } from "./classifier.js";
import { AIService } from "../services/ai/service.js";
import { RBACService, AuditLog, SecurityError } from "../services/security/index.js";
import { SessionRateLimiter, RateLimitError } from "./rate-limiter.js";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

export interface OrchestratorOptions extends Partial<OrchestratorConfig> {
  maxRetries?: number;
  retryDelayMs?: number;
  /** Включить RBAC проверку при регистрации и вызове агентов */
  enableRBAC?: boolean;
  /** Включить rate limiting per-session (по умолчанию true) */
  enableRateLimit?: boolean;
  /** Запросов в секунду per-session (по умолчанию 5) */
  requestsPerSecond?: number;
  /** Максимум burst токенов (по умолчанию 3) */
  rateLimitBurst?: number;
}

export class Orchestrator {
  private agents: Map<string, AgentDescriptor> = new Map();
  private config: OrchestratorConfig;
  private maxRetries: number;
  private retryDelayMs: number;
  private conversations: ConversationStore;
  private tracer: Tracer;
  private router: SemanticRouter;
  private ai: AIService;
  // === RBAC Integration (MS Reference Architecture: Security) ===
  private rbac: RBACService;
  private auditLog: AuditLog;
  private rbacEnabled: boolean;
  // === Rate Limiting (MS Reference Architecture: Threat Model — DoS mitigation) ===
  private rateLimiter: SessionRateLimiter;
  private rateLimitEnabled: boolean;

  constructor(options?: OrchestratorOptions) {
    this.config = {
      maxAgents: options?.maxAgents ?? 10,
      defaultAgentId: options?.defaultAgentId ?? "default",
    };
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.conversations = new ConversationStore();
    this.tracer = new Tracer({ minLevel: "info", enableConsole: true });
    this.ai = new AIService();
    this.router = new SemanticRouter({ ai: this.ai, llmFallback: true });
    // RBAC init
    this.rbac = new RBACService();
    this.auditLog = new AuditLog();
    this.rbacEnabled = options?.enableRBAC ?? true;
    // Rate limiter init
    this.rateLimitEnabled = options?.enableRateLimit ?? true;
    this.rateLimiter = new SessionRateLimiter({
      requestsPerSecond: options?.requestsPerSecond ?? 5,
      maxBurst: options?.rateLimitBurst ?? 3,
    });
  }

  /**
   * Получить RBACService для настройки ролей агентов.
   * Пример: orchestrator.getRBAC().setAgentRole("web-agent", "researcher");
   */
  getRBAC(): RBACService {
    return this.rbac;
  }

  /**
   * Получить AuditLog для просмотра записей доступа.
   */
  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  registerAgent(agent: AgentDescriptor): void {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error("Agent limit reached");
    }
    this.agents.set(agent.id, agent);

    // RBAC: установить роль агенту (по умолчанию readonly)
    if (this.rbacEnabled) {
      const role: AgentRole = agent.role ?? "readonly";
      this.rbac.setAgentRole(agent.id, role);
      this.tracer.info("Orchestrator", "Agent role set: " + agent.id + " -> " + role, {
        agentId: agent.id,
        role,
      });
    }

    this.tracer.info("Orchestrator", "Agent registered: " + agent.id, {
      agentId: agent.id,
      capabilities: agent.capabilities,
      role: agent.role ?? "readonly",
    });
  }

  getAgent(id: string): AgentDescriptor | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentDescriptor[] {
    return [...this.agents.values()];
  }

  /**
   * Найти агента по capability (Semantic Router Pattern)
   */
  private findAgentByCapability(capability: string): AgentDescriptor | undefined {
    // Сначала ищем точное совпадение
    for (const agent of this.agents.values()) {
      if (agent.capabilities.includes(capability) && agent.status !== "inactive") {
        return agent;
      }
    }
    // Fallback: ищем general
    for (const agent of this.agents.values()) {
      if (agent.capabilities.includes("general") && agent.status !== "inactive") {
        return agent;
      }
    }
    return undefined;
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

  /**
   * RBAC: проверить доступ агента к инструменту.
   * Логирует в auditLog. Возвращает true если доступ разрешён.
   */
  checkToolAccess(agentId: string, toolName: string): boolean {
    if (!this.rbacEnabled) return true;
    const allowed = this.rbac.canUseTool(agentId, toolName);
    this.auditLog.log({
      timestamp: Date.now(),
      agentId,
      action: "tool_call",
      resource: toolName,
      allowed,
      reason: allowed ? undefined : `RBAC: agent "${agentId}" cannot use "${toolName}"`,
    });
    return allowed;
  }

  /**
   * RBAC: проверить доступ агента к инструменту, выбросить SecurityError при отказе
   */
  validateToolAccess(agentId: string, toolName: string): void {
    if (!this.rbacEnabled) return;
    this.rbac.validateToolAccess(agentId, toolName);
  }

  async handle(message: string, sessionId?: string): Promise<AgentResponse> {
    const sid = sessionId ?? "default";

    // === Rate Limiting (MS Reference Architecture: Threat Model — DoS mitigation) ===
    if (this.rateLimitEnabled) {
      const rateCheck = this.rateLimiter.check(sid);
      if (!rateCheck.allowed) {
        this.tracer.warn("Orchestrator", "Rate limit exceeded for session: " + sid, {
          sessionId: sid,
          retryAfterMs: rateCheck.retryAfterMs,
        });
        return {
          agentId: "orchestrator",
          content: "Слишком много запросов. Попробуйте через " + Math.ceil(rateCheck.retryAfterMs / 1000) + " сек.",
          confidence: 0,
        };
      }
      this.rateLimiter.acquire(sid);
    }

    const traceId = this.tracer.startTrace("Orchestrator", "handle", { sessionId: sid });

    // Сохраняем сообщение пользователя в историю
    this.conversations.addMessage(sid, "user", message);

    // === Semantic Router: классифицируем intent ===
    const classification = await this.router.classify(message);
    const capability = SemanticRouter.resolveCapability(classification.intent);

    this.tracer.info("Orchestrator", "Intent classified", {
      intent: classification.intent,
      capability,
      confidence: classification.confidence,
      method: classification.method,
      traceId,
    });

    // Находим агента по capability
    const agent = this.findAgentByCapability(capability);

    if (!agent) {
      this.tracer.warn("Orchestrator", "No agent found for capability: " + capability, {
        intent: classification.intent,
        capability,
        traceId,
      });

      // Fallback на default agent
      const defaultAgent = this.agents.get(this.config.defaultAgentId);
      if (!defaultAgent) {
        this.tracer.error("Orchestrator", "No agent available", { traceId });
        return {
          agentId: "none",
          content: "No agent available for intent: " + classification.intent,
          confidence: 0,
        };
      }

      this.tracer.info("Orchestrator", "Falling back to default agent", {
        defaultAgentId: defaultAgent.id,
        traceId,
      });
      return this.executeAgentWithRetry(defaultAgent, message, sid, traceId);
    }

    this.tracer.info("Orchestrator", "Routing to agent: " + agent.id, {
      agentId: agent.id,
      capability,
      traceId,
    });

    return this.executeAgentWithRetry(agent, message, sid, traceId);
  }

  /**
   * Выполнить агента с retry и graceful degradation
   */
  private async executeAgentWithRetry(
    agent: AgentDescriptor,
    message: string,
    sessionId: string,
    traceId: string,
  ): Promise<AgentResponse> {
    let lastError: Error | undefined;

    // RBAC audit: AgentCall
    this.auditLog.log({
      timestamp: Date.now(),
      agentId: agent.id,
      action: "agent_call",
      resource: "handler",
      allowed: true,
      traceId,
    });

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const response = await this.executeAgent(agent, message, sessionId, traceId);

        // Если успешно после retry — логируем
        if (attempt > 1) {
          this.tracer.info("Orchestrator", "Agent succeeded after retry", {
            agentId: agent.id,
            attempt,
            traceId,
          });
        }

        return response;
      } catch (e: any) {
        lastError = e;
        this.tracer.warn("Orchestrator", "Agent failed (attempt " + attempt + ")", {
          agentId: agent.id,
          attempt,
          maxRetries: this.maxRetries + 1,
          error: e.message,
          traceId,
        });

        // Если есть ещё попытки — ждём перед retry
        if (attempt <= this.maxRetries) {
          const delay = this.retryDelayMs * attempt; // Экспоненциальный backoff
          this.tracer.info("Orchestrator", "Retrying after " + delay + "ms", {
            agentId: agent.id,
            attempt,
            traceId,
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // Все попытки исчерпаны — graceful degradation
    this.tracer.error("Orchestrator", "All retries exhausted, falling back to degraded mode", {
      agentId: agent.id,
      totalAttempts: this.maxRetries + 1,
      lastError: lastError?.message,
      traceId,
    });

    // Пробуем fallback на general-agent
    const fallbackAgent = this.findAgentByCapability("general");
    if (fallbackAgent && fallbackAgent.id !== agent.id) {
      this.tracer.info("Orchestrator", "Falling back to general agent", {
        originalAgentId: agent.id,
        fallbackAgentId: fallbackAgent.id,
        traceId,
      });

      try {
        return await this.executeAgent(fallbackAgent, message, sessionId, traceId);
      } catch (e: any) {
        this.tracer.error("Orchestrator", "Fallback agent also failed", {
          fallbackAgentId: fallbackAgent.id,
          error: e.message,
          traceId,
        });
      }
    }

    // Полный провал — возвращаем degraded response
    return {
      agentId: agent.id,
      content: "Извините, произошла ошибка при обработке запроса. Попробуйте позже или переформулируйте вопрос.",
      confidence: 0,
    };
  }

  private async executeAgent(
    agent: AgentDescriptor,
    message: string,
    sessionId: string,
    traceId: string,
  ): Promise<AgentResponse> {
    const request: AgentRequest = {
      id: uuid(),
      message,
      sessionId,
    };

    const startTime = Date.now();
    try {
      const response = await agent.handler(request);
      const durationMs = Date.now() - startTime;

      // Сохраняем ответ агента в историю
      this.conversations.addMessage(sessionId, "assistant", response.content, {
        agentId: response.agentId,
      });

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
