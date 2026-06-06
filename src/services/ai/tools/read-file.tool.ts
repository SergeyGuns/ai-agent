import fs from "fs";
import { ToolDefinition } from "../types.js";

export function createReadFileTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "read_file",
        description: "Прочитать содержимое файла",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Путь к файлу" },
          },
          required: ["file_path"],
        },
      },
    },
    handler: async (args) => {
      const filePath = args.file_path as string;
      const fullPath = filePath.startsWith("/") ? filePath : workspaceRoot + "/" + filePath;
      try {
        return fs.readFileSync(fullPath, "utf-8");
      } catch (e: any) {
        return "Error: " + e.message;
      }
    },
  };
}
