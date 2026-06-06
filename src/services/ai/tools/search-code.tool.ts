import { execSync } from "child_process";
import { ToolDefinition } from "../types.js";

export function createSearchCodeTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "search_code",
        description: "Поиск по коду с помощью grep/rg",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Паттерн поиска" },
            path: { type: "string", description: "Путь для поиска" },
          },
          required: ["pattern"],
        },
      },
    },
    handler: async (args) => {
      try {
        const result = execSync(
          'rg --no-heading --line-number "' + (args.pattern as string) + '" ' + (args.path as string || "."),
          { cwd: workspaceRoot, timeout: 15000 }
        );
        return result.toString() || "No matches found";
      } catch (e: any) {
        return e.stdout?.toString() || "Error: " + e.message;
      }
    },
  };
}
