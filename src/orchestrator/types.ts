export type AgentRole = "admin" | "developer" | "researcher" | "readonly";

export interface AgentDescriptor {
  id: string;
  name: string;
  type: "local" | "remote";
  capabilities: string[];
  handler: (request: AgentRequest) => Promise<AgentResponse>;
  version?: string;
  status?: "active" | "inactive" | "degraded";
  description?: string;
  metadata?: Record<string, string>;
  // === RBAC (MS Reference Architecture: Security) ===
  /** Роль агента для контроля доступа к инструментам */
  role?: AgentRole;
  // === Versioning (MS Reference Architecture: Versioning Strategies) ===
  /** Версия system prompt (для canary/rollback) */
  promptVersion?: string;
  /** Версия модели (для отслеживания качества) */
  modelVersion?: string;
  /** Доля трафика для canary (0.0-1.0, по умолчанию 1.0) */
  trafficWeight?: number;
}

export interface AgentRequest {
  id: string;
  message: string;
  context?: Record<string, unknown>;
  sessionId?: string;
}

export interface AgentResponse {
  agentId: string;
  content: string;
  confidence: number;
  /** Версия агента, которая обработала запрос (для отслеживания) */
  agentVersion?: string;
}

export interface OrchestratorConfig {
  maxAgents: number;
  defaultAgentId: string;
}

/**
 * Результат проверки совместимости версий
 */
export interface VersionCheckResult {
  compatible: boolean;
  currentVersion: string;
  targetVersion: string;
  breaking: boolean;
  changes: string[];
}
