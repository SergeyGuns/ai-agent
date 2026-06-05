import { ToolDefinition } from "../types.js";
import { promises as fs } from "fs";
import path from "path";

export function createReadFileTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Прочитать содержимое файла. " +
          'Используй когда пользователь прямо просит "прочитай файл [путь]" или "покажи содержимое [файл]". ' +
          "НЕ используй для вопросов о коде — для этого ask_codebase.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Путь к файлу относительно проекта",
            },
          },
          required: ["file_path"],
        },
      },
    },
    handler: async (args): Promise<string> => {
      const filePath = args.file_path as string;
      const fullPath = path.resolve(workspaceRoot, filePath);

      if (!fullPath.startsWith(workspaceRoot)) {
        return "Ошибка: доступ за пределы проекта запрещён";
      }

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n").length;
        return `Файл: ${filePath} (${lines} строк)\n\n${content}`;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Ошибка чтения: ${msg}`;
      }
    },
  };
}
