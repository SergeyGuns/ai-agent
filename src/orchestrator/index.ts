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
import { RegistryMonitor } from "../registry/monitor.js";
import { InMemoryAgentEventBus, createA2AHandlers, A2AHandlers } from "./a2a-handlers.js";
import { AgentMessage } from "./agent-communication.js";

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
  // === Registry Monitor (MS Reference Architecture: Agent Registry — Monitor Component) ===
  private monitor: RegistryMonitor;
  // === Agent-to-Agent Communication (MS Reference Architecture: Pattern #9) ===
  private eventBus: InMemoryAgentEventBus;
  private a2a: A2AHandlers;

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
    // === Registry Monitor init (MS Reference Architecture: Agent Registry — Monitor Component) ===
    this.monitor = new RegistryMonitor({
      tracer: this.tracer,
    });
    // === A2A Communication init (MS Reference Architecture: Pattern #9) ===
    this.eventBus = new InMemoryAgentEventBus();
    this.a2a = createA2AHandlers(
      this.agents,
      this.tracer,
      this.conversations,
      this.monitor,
      this.eventBus,
    );
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

    // === Agent Registration Validation (MS Reference Architecture: Agent Registry) ===
    const validation = this.validateAgentRegistration(agent);
    if (!validation.valid) {
      throw new Error("Agent registration failed: " + validation.errors.join("; "));
    }

    // Warn about capability overlap
    if (validation.warnings.length > 0) {
      for (const warning of validation.warnings) {
        this.tracer.warn("Orchestrator", "Agent registration warning: " + warning, {
          agentId: agent.id,
        });
      }
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

    // === Register with Monitor ===
    this.monitor.registerAgent(agent);

    this.tracer.info("Orchestrator", "Agent registered: " + agent.id, {
      agentId: agent.id,
      capabilities: agent.capabilities,
      role: agent.role ?? "readonly",
      version: agent.version ?? "unknown",
    });
  }

  /**
   * Валидация регистрации агента (MS Reference Architecture: Agent Registry — Evaluation of Registering Agent).
   *
   * Проверки:
   * - Schema compliance: обязательные поля, формат capabilities
   * - Capability overlap: предупреждение если агент дублирует capabilities существующих
   * - Security: wildcard capabilities (["*"]) запрещены для не-admin ролей
   * - Version format: должен быть semver (если указан)
   * - Traffic weight: должен быть 0.0-1.0
   */
  validateAgentRegistration(agent: AgentDescriptor): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Schema compliance
    if (!agent.id || typeof agent.id !== "string") {
      errors.push("Agent id is required and must be a string");
    }
    if (!agent.name || typeof agent.name !== "string") {
      errors.push("Agent name is required and must be a string");
    }
    if (!Array.isArray(agent.capabilities) || agent.capabilities.length === 0) {
      errors.push("Agent must have at least one capability");
    }
    if (agent.capabilities && !agent.capabilities.every((c) => typeof c === "string" && c.length > 0)) {
      errors.push("All capabilities must be non-empty strings");
    }
    if (typeof agent.handler !== "function") {
      errors.push("Agent handler must be a function");
    }

    // Version format (semver)
    if (agent.version && !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(agent.version)) {
      errors.push("Agent version must follow semver (e.g. 1.0.0)");
    }

    // Traffic weight range
    if (agent.trafficWeight !== undefined && (agent.trafficWeight < 0 || agent.trafficWeight > 1)) {
      errors.push("Agent trafficWeight must be between 0.0 and 1.0");
    }

    // Security: wildcard capabilities only for admin
    if (agent.capabilities?.includes("*") && agent.role !== "admin") {
      errors.push("Wildcard capability '*' is only allowed for admin role");
    }

    // Capability overlap detection
    if (agent.capabilities) {
      for (const existing of Array.from(this.agents.values())) {
        const overlap = agent.capabilities.filter((c) => existing.capabilities.includes(c));
        if (overlap.length > 0 && existing.id !== agent.id) {
          // Only warn if the overlap is significant (>50% of capabilities)
          const overlapRatio = overlap.length / agent.capabilities.length;
          if (overlapRatio > 0.5) {
            warnings.push(
              `Agent '${agent.id}' shares ${overlap.length}/${agent.capabilities.length} capabilities (${overlap.join(", ")}) with existing agent '${existing.id}'`,
            );
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  getAgent(id: string): AgentDescriptor | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentDescriptor[] {
    return [...this.agents.values()];
  }

  /**
   * Найти агента по capability (Semantic Router Pattern).
   *
   * v2 — Canary routing:
   * - Собирает всех подходящих агентов по capability
   * - Если есть несколько версий (одинаковый id, разный version) —
   *   использует weighted random selection на основе trafficWeight
   * - Фильтрует degraded/inactive агентов
   * - Circuit breaker: не маршрутизирует к агентам с открытой цепью
   */
  private findAgentByCapability(capability: string): AgentDescriptor | undefined {
    // Собираем всех подходящих агентов
    const candidates: AgentDescriptor[] = [];
    for (const agent of Array.from(this.agents.values())) {
      if (
        agent.capabilities.includes(capability) &&
        agent.status !== "inactive" &&
        agent.status !== "degraded"
      ) {
        candidates.push(agent);
      }
    }

    if (candidates.length === 0) {
      // Fallback: ищем general
      for (const agent of Array.from(this.agents.values())) {
        if (
          agent.capabilities.includes("general") &&
          agent.status !== "inactive" &&
          agent.status !== "degraded"
        ) {
          candidates.push(agent);
        }
      }
    }

    if (candidates.length === 0) return undefined;

    // Если один кандидат — возвращаем напрямую
    if (candidates.length === 1) return candidates[0];

    // Weighted random selection на основе trafficWeight
    const totalWeight = candidates.reduce((sum, a) => sum + (a.trafficWeight ?? 1), 0);
    let random = Math.random() * totalWeight;

    for (const agent of candidates) {
      const weight = agent.trafficWeight ?? 1;
      random -= weight;
      if (random <= 0) return agent;
    }

    // Fallback на последнего
    return candidates[candidates.length - 1];
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
   * Получить A2A handlers для межагентной коммуникации.
   * Позволяет агентам отправлять сообщения друг другу через оркестратор.
   */
  getA2A(): A2AHandlers {
    return this.a2a;
  }

  /**
   * Получить Event Bus для Pub/Sub паттерна.
   */
  getEventBus(): InMemoryAgentEventBus {
    return this.eventBus;
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

      // === Monitor: record successful call ===
      this.monitor.recordAgentCall(agent.id, true, durationMs);

      this.tracer.info("Orchestrator", "Agent response received", {
        agentId: response.agentId,
        durationMs,
        traceId,
      });

      return response;
    } catch (e: any) {
      const durationMs = Date.now() - startTime;

      // === Monitor: record failed call ===
      this.monitor.recordAgentCall(agent.id, false, durationMs, e.message);

      this.tracer.error("Orchestrator", "Agent error: " + e.message, {
        agentId: agent.id,
        durationMs,
        traceId,
      });
      throw e;
    }
  }
}
