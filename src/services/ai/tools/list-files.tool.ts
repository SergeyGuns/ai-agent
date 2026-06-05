import { ToolDefinition } from "../types.js";
import { promises as fs } from "fs";
import path from "path";

const IGNORE_DIRS = ["node_modules", ".git", "dist", ".next", "coverage"];

export function createListFilesTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "list_files",
        description: "Показать список файлов в директории.",
        parameters: {
          type: "object",
          properties: {
            dir_path: {
              type: "string",
              description: "Путь к директории (по умолчанию — корень)",
            },
          },
          required: [],
        },
      },
    },
    handler: async (args): Promise<string> => {
      const dirPath = (args.dir_path as string) || ".";
      const fullPath = path.resolve(workspaceRoot, dirPath);

      if (!fullPath.startsWith(workspaceRoot)) {
        return "Ошибка: доступ за пределы проекта запрещён";
      }

      try {
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const lines = entries
          .filter((e) => !IGNORE_DIRS.includes(e.name))
          .map((e) =>
            e.isDirectory() ? `[DIR]  ${e.name}` : `[FILE] ${e.name}`,
          );

        return lines.length > 0 ? lines.join("\n") : "Пустая директория";
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Ошибка: ${msg}`;
      }
    },
  };
}
