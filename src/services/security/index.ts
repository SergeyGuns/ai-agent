import * as path from "node:path";
import * as fs from "node:fs";
import { AgentRole } from "../../orchestrator/types.js";

/**
 * Security модуль для мультиагентной системы.
 *
 * Реализует Security Principles из MS Reference Architecture:
 * - Workspace boundary: агенты не могут читать файлы за пределами workspace root
 * - RBAC: ролевой доступ к tool calls
 * - Audit log: все tool calls логируются с caller identity
 * - PII redaction: маскировка чувствительных данных в логах
 */

// === Workspace Boundary ===

export class WorkspaceBoundary {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
  }

  /**
   * Проверить, что путь находится внутри workspace
   */
  isWithinWorkspace(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return resolved.startsWith(this.rootPath + path.sep) || resolved === this.rootPath;
  }

  /**
   * Валидировать путь и выбросить ошибку если он вне workspace
   */
  validatePath(filePath: string): string {
    if (!this.isWithinWorkspace(filePath)) {
      throw new SecurityError(
        `Access denied: path "${filePath}" is outside workspace root "${this.rootPath}"`,
        "WORKSPACE_BOUNDARY_VIOLATION",
      );
    }
    return path.resolve(filePath);
  }

  /**
   * Безопасно прочитать файл (с проверкой workspace boundary)
   */
  safeReadFile(filePath: string): string {
    const safePath = this.validatePath(filePath);
    return fs.readFileSync(safePath, "utf-8");
  }

  /**
   * Безопасно записать файл (с проверкой workspace boundary)
   */
  safeWriteFile(filePath: string, content: string): void {
    const safePath = this.validatePath(filePath);
    fs.writeFileSync(safePath, content, "utf-8");
  }

  /**
   * Безопасно получить список файлов (с проверкой workspace boundary)
   */
  safeListFiles(dirPath: string): string[] {
    const safePath = this.validatePath(dirPath);
    return fs.readdirSync(safePath);
  }
}

// === RBAC ===

export interface ToolPolicy {
  toolName: string;
  allowedRoles: AgentRole[];
  description: string;
}

export const DEFAULT_TOOL_POLICIES: ToolPolicy[] = [
  { toolName: "read_file", allowedRoles: ["admin", "developer", "researcher", "readonly"], description: "Read file contents" },
  { toolName: "list_files", allowedRoles: ["admin", "developer", "researcher", "readonly"], description: "List directory contents" },
  { toolName: "search_code", allowedRoles: ["admin", "developer", "researcher", "readonly"], description: "Search code" },
  { toolName: "ask_codebase", allowedRoles: ["admin", "developer", "researcher"], description: "Query codebase with LLM" },
  { toolName: "write_file", allowedRoles: ["admin", "developer"], description: "Write file contents" },
  { toolName: "run_command", allowedRoles: ["admin"], description: "Execute shell commands" },
  { toolName: "web_search", allowedRoles: ["admin", "developer", "researcher"], description: "Search the web" },
  { toolName: "fetch_page", allowedRoles: ["admin", "developer", "researcher"], description: "Fetch web page" },
  { toolName: "finish", allowedRoles: ["admin", "developer", "researcher", "readonly"], description: "Finish task" },
];

export class RBACService {
  private policies: Map<string, ToolPolicy>;
  private agentRoles: Map<string, AgentRole>;

  constructor(policies: ToolPolicy[] = DEFAULT_TOOL_POLICIES) {
    this.policies = new Map(policies.map((p) => [p.toolName, p]));
    this.agentRoles = new Map();
  }

  /**
   * Установить роль агенту
   */
  setAgentRole(agentId: string, role: AgentRole): void {
    this.agentRoles.set(agentId, role);
  }

  /**
   * Получить роль агента
   */
  getAgentRole(agentId: string): AgentRole {
    return this.agentRoles.get(agentId) || "readonly";
  }

  /**
   * Проверить, может ли агент использовать tool
   */
  canUseTool(agentId: string, toolName: string): boolean {
    const policy = this.policies.get(toolName);
    if (!policy) {
      // Неизвестный tool — запрещаем по умолчанию
      return false;
    }
    const role = this.getAgentRole(agentId);
    return policy.allowedRoles.includes(role);
  }

  /**
   * Валидировать доступ к tool и выбросить ошибку если запрещено
   */
  validateToolAccess(agentId: string, toolName: string): void {
    if (!this.canUseTool(agentId, toolName)) {
      const role = this.getAgentRole(agentId);
      throw new SecurityError(
        `Access denied: agent "${agentId}" with role "${role}" cannot use tool "${toolName}"`,
        "RBAC_VIOLATION",
      );
    }
  }

  /**
   * Получить список разрешённых tools для агента
   */
  getAllowedTools(agentId: string): string[] {
    const role = this.getAgentRole(agentId);
    return Array.from(this.policies.values())
      .filter((p) => p.allowedRoles.includes(role))
      .map((p) => p.toolName);
  }
}

// === PII Redaction ===

const PII_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Email
  { pattern: /[\w.-]+@[\w.-]+\.\w+/g, replacement: "[EMAIL_REDACTED]" },
  // Phone (Russian)
  { pattern: /\+7[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, replacement: "[PHONE_REDACTED]" },
  // API keys / tokens
  { pattern: /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, replacement: "[CREDENTIAL_REDACTED]" },
  // Credit cards
  { pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, replacement: "[CARD_REDACTED]" },
];

export function redactPII(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// === Security Error ===

export class SecurityError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SecurityError";
    this.code = code;
  }
}

// === Audit Log ===

export interface AuditEntry {
  timestamp: number;
  agentId: string;
  action: string;
  resource: string;
  allowed: boolean;
  reason?: string;
  traceId?: string;
  sessionId?: string;
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  log(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  getEntriesByAgent(agentId: string): AuditEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  getDeniedEntries(): AuditEntry[] {
    return this.entries.filter((e) => !e.allowed);
  }

  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
