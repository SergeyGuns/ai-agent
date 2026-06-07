import { ToolDefinition, Tool } from "../types.js";
import { RBACService, AuditLog, redactPII } from "../../security/index.js";

export interface ToolRegistryOptions {
  workspaceRoot: string;
  rbac?: RBACService;
  auditLog?: AuditLog;
  agentId?: string;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private rbac?: RBACService;
  private auditLog?: AuditLog;
  private agentId: string;

  constructor(options: ToolRegistryOptions | string) {
    // Обратная совместимость: если передана строка — это workspaceRoot
    if (typeof options === "string") {
      this.agentId = "default";
      this._registerDefaults(options);
    } else {
      this.agentId = options.agentId || "default";
      this.rbac = options.rbac;
      this.auditLog = options.auditLog;
      this._registerDefaults(options.workspaceRoot);
    }
  }

  private _registerDefaults(workspaceRoot: string): void {
    this.register(finishTool);
    this.register(createReadFileTool(workspaceRoot));
    this.register(createListFilesTool(workspaceRoot));
    this.register(createRunCommandTool(workspaceRoot));
    this.register(createWriteFileTool(workspaceRoot));
    this.register(createSearchCodeTool(workspaceRoot));
    this.register(createAskCodebaseTool());
  }

  register(def: ToolDefinition): void {
    this.tools.set(def.tool.function.name, def);
  }

  getToolManifests(): Tool[] {
    return Array.from(this.tools.values()).map((t) => t.tool);
  }

  /**
   * Установить ID агента (для RBAC проверок)
   */
  setAgentId(agentId: string): void {
    this.agentId = agentId;
  }

  /**
   * Получить текущий ID агента
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Проверить права агента на использование инструмента
   */
  canUseTool(toolName: string): boolean {
    if (!this.rbac) return true; // Если RBAC не настроен — разрешаем всё
    return this.rbac.canUseTool(this.agentId, toolName);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);

    // RBAC проверка
    if (this.rbac && !this.canUseTool(name)) {
      const role = this.rbac.getAgentRole(this.agentId);
      const errorMsg = `Access denied: agent "${this.agentId}" with role "${role}" cannot use tool "${name}"`;

      // Audit log для отклонённого вызова
      this.auditLog?.log({
        timestamp: Date.now(),
        agentId: this.agentId,
        action: "tool_call",
        resource: name,
        allowed: false,
        reason: errorMsg,
      });

      throw new Error(errorMsg);
    }

    let result: string;
    let success = true;

    if (!tool) {
      result = "Unknown tool: " + name;
      success = false;
    } else {
      try {
        result = await tool.handler(args);
      } catch (e: any) {
        result = "Error: " + e.message;
        success = false;
      }
    }

    // Audit log для разрешённого вызова
    this.auditLog?.log({
      timestamp: Date.now(),
      agentId: this.agentId,
      action: "tool_call",
      resource: name,
      allowed: true,
    });

    return result;
  }

  /**
   * Получить список разрешённых инструментов для текущего агента
   */
  getAllowedTools(): string[] {
    if (!this.rbac) return Array.from(this.tools.keys());
    return Array.from(this.tools.keys()).filter((name) =>
      this.rbac!.canUseTool(this.agentId, name),
    );
  }
}

// === Импорт tool definitions ===
import { finishTool } from "./finish.tool.js";
import { createReadFileTool } from "./read-file.tool.js";
import { createListFilesTool } from "./list-files.tool.js";
import { createRunCommandTool } from "./run-command.tool.js";
import { createWriteFileTool } from "./write-file.tool.js";
import { createSearchCodeTool } from "./search-code.tool.js";
import { createAskCodebaseTool } from "./ask-codebase.tool.js";
