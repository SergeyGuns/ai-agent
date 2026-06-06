import { ToolDefinition, Tool } from "../types.js";
import { finishTool } from "./finish.tool.js";
import { createReadFileTool } from "./read-file.tool.js";
import { createListFilesTool } from "./list-files.tool.js";
import { createRunCommandTool } from "./run-command.tool.js";
import { createWriteFileTool } from "./write-file.tool.js";
import { createSearchCodeTool } from "./search-code.tool.js";
import { createAskCodebaseTool } from "./ask-codebase.tool.js";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(workspaceRoot: string) {
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

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return "Unknown tool: " + name;
    return tool.handler(args);
  }
}
