import { Tool, ToolHandler, ToolDefinition } from "../types.js";
import { createReadFileTool } from "./read-file.tool.js";
import { createWriteFileTool } from "./write-file.tool.js";
import { createListFilesTool } from "./list-files.tool.js";
import { createRunCommandTool } from "./run-command.tool.js";
import { createAskCodebaseTool } from "./ask-codebase.tool.js";
import { finishTool } from "./finish.tool.js";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(workspaceRoot: string) {
    this.register(createReadFileTool(workspaceRoot));
    this.register(createWriteFileTool(workspaceRoot));
    this.register(createListFilesTool(workspaceRoot));
    this.register(createRunCommandTool(workspaceRoot));
    this.register(createAskCodebaseTool(workspaceRoot));
    this.register(finishTool);
    // search_code убран — используй ask_codebase
  }

  private register(def: ToolDefinition): void {
    this.tools.set(def.tool.function.name, def);
  }

  getToolManifests(): Tool[] {
    return Array.from(this.tools.values()).map((d) => d.tool);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const handler = this.tools.get(name)?.handler;
    if (!handler) return `Инструмент "${name}" не найден`;
    return handler(args);
  }
}
