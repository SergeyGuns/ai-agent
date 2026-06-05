import { ToolDefinition } from "../types.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

const BLOCKED = ["rm -rf /", "sudo", "chmod 777", "mkfs", "dd if="];

export function createRunCommandTool(workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "run_command",
        description:
          "Выполнить команду в терминале (npm, git, tsc, node, npx).",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Команда для выполнения",
            },
          },
          required: ["command"],
        },
      },
    },
    handler: async (args): Promise<string> => {
      const command = args.command as string;

      for (const pattern of BLOCKED) {
        if (command.includes(pattern)) {
          return `Заблокировано: "${pattern}"`;
        }
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceRoot,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        let output = stdout || "";
        if (stderr) output += `\n[stderr]\n${stderr}`;
        return output || "Выполнено (нет вывода)";
      } catch (error: unknown) {
        if (error instanceof Error) {
          const execError = error as Error & {
            stdout?: string;
            stderr?: string;
            code?: number;
          };
          let output = execError.stdout || "";
          if (execError.stderr) output += `\n[stderr]\n${execError.stderr}`;
          if (execError.code) output += `\n[exit: ${execError.code}]`;
          return output || `Ошибка: ${execError.message}`;
        }
        return `Ошибка: ${String(error)}`;
      }
    },
  };
}
