import { ToolDefinition } from "../types.js";
import { promises as fs } from "fs";
import path from "path";

export function createWriteFileTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Записать содержимое в файл. Создаёт файл если не существует.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Путь к файлу",
            },
            content: {
              type: "string",
              description: "Содержимое файла",
            },
          },
          required: ["file_path", "content"],
        },
      },
    },
    handler: async (args): Promise<string> => {
      const filePath = args.file_path as string;
      const content = args.content as string;
      const fullPath = path.resolve(workspaceRoot, filePath);

      if (!fullPath.startsWith(workspaceRoot)) {
        return "Ошибка: доступ за пределы проекта запрещён";
      }

      try {
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
        const lines = content.split("\n").length;
        return `Записано: ${filePath} (${lines} строк)`;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Ошибка записи: ${msg}`;
      }
    },
  };
}
