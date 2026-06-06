import * as fs from "fs";
import * as path from "path";
import { ToolDefinition } from "../types.js";

export function createWriteFileTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "write_file",
        description: "Записать содержимое в файл",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Путь к файлу" },
            content: { type: "string", description: "Содержимое" },
          },
          required: ["file_path", "content"],
        },
      },
    },
    handler: async (args) => {
      const filePath = args.file_path as string;
      const fullPath = filePath.startsWith("/") ? filePath : workspaceRoot + "/" + filePath;
      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, args.content as string);
        return "File written successfully";
      } catch (e: any) {
        return "Error: " + e.message;
      }
    },
  };
}
