import { ToolDefinition } from "../types.js";
import { promises as fs } from "fs";
import { minimatch } from "minimatch";
import path from "path";

const IGNORE_DIRS = ["node_modules", ".git", "dist", ".next", "coverage"];
const MAX_RESULTS = 20;

function matchesGlob(filename: string, pattern: string): boolean {
  return minimatch(filename, pattern);
}

async function searchDir(
  dir: string,
  query: string,
  pattern: string,
  results: string[],
  depth: number,
): Promise<void> {
  if (depth > 4 || results.length >= MAX_RESULTS) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry.name)) continue;
    if (results.length >= MAX_RESULTS) break;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await searchDir(fullPath, query, pattern, results, depth + 1);
    } else if (entry.isFile() && matchesGlob(entry.name, pattern)) {
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_RESULTS) break;
          if (lines[i].toLowerCase().includes(query.toLowerCase())) {
            const relPath = path.relative(dir, fullPath);
            results.push(`${relPath}:${i + 1}  ${lines[i].trim()}`);
          }
        }
      } catch {
        // skip binary/unreadable
      }
    }
  }
}

export function createSearchCodeTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "search_code",
        description:
          "Поиск текста по файлам проекта. " +
          "Используй ТОЛЬКО когда нужно найти конкретную строку или имя переменной в коде. " +
          'Для вопросов "как работает" / "что делает" — используй ask_codebase.',
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Текст для поиска",
            },
            file_pattern: {
              type: "string",
              description: "Маска файлов, например: .ts или .tsx",
            },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args): Promise<string> => {
      const query = (args.query as string).toLowerCase();
      const pattern = (args.file_pattern as string) || "*.ts";

      try {
        const results: string[] = [];
        await searchDir(workspaceRoot, query, pattern, results, 0);

        if (results.length === 0) return "Ничего не найдено";

        const limited = results.slice(0, MAX_RESULTS);
        const suffix =
          results.length >= MAX_RESULTS
            ? `\n... и ещё ${results.length - MAX_RESULTS} совпадений`
            : "";

        return `Найдено ${results.length}:\n${limited.join("\n")}${suffix}`;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Ошибка: ${msg}`;
      }
    },
  };
}
