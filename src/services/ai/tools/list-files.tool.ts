import fs from "fs";
import { ToolDefinition } from "../types.js";

export function createListFilesTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "list_files",
        description: "Список файлов в директории",
        parameters: {
          type: "object",
          properties: {
            dir_path: { type: "string", description: "Путь к директории" },
          },
          required: ["dir_path"],
        },
      },
    },
    handler: async (args) => {
      const dirPath = args.dir_path as string;
      const fullPath = dirPath.startsWith("/") ? dirPath : workspaceRoot + "/" + dirPath;
      try {
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? "[dir] " + e.name : e.name)).join("\n");
      } catch (e: any) {
        return "Error: " + e.message;
      }
    },
  };
}
