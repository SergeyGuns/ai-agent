import { execSync } from "child_process";
import { ToolDefinition } from "../types.js";

export function createRunCommandTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "run_command",
        description: "Выполнить shell-команду",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Команда" },
          },
          required: ["command"],
        },
      },
    },
    handler: async (args) => {
      try {
        const result = execSync(args.command as string, { cwd: workspaceRoot, timeout: 30000 });
        return result.toString();
      } catch (e: any) {
        return "Error: " + e.message;
      }
    },
  };
}
