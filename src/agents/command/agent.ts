import { execSync, exec } from "child_process";
import { AIService } from "../../services/ai/service.js";
import { Tool, ChatMessage } from "../../services/ai/types.js";

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ToolCallLog {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

function buildSystemPrompt(workspaceRoot: string): string {
  return `Ты — Command Agent. Выполняешь shell-команды для пользователя.

РАБОЧАЯ ДИРЕКТОРИЯ: ${workspaceRoot}

ПРАВИЛА:
1. Анализируй запрос пользователя и формируй правильную команду
2. Используй run_command для выполнения
3. Если команда вернула ошибку — проанализируй stderr и попробуй исправить
4. Для опасных команд (rm -rf, sudo, format) — предупреди пользователя
5. После получения результата — объясни его на русском языке
6. Используй finish(answer) для финального ответа

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
- run_command(command, timeout?) — выполнить shell-команду (таймаут в мс, по умолчанию 30000)
- run_command_async(command) — запустить команду асинхронно (для долгих процессов)
- list_files(dir?) — список файлов в директории
- read_file(path) — прочитать файл
- finish(answer) — завершить с ответом

ПРИМЕРЫ ЗАПРОСОВ:
- "запусти тесты" → run_command("npm test")
- "какие файлы в проекте?" → list_files()
- "собери проект" → run_command("npm run build")
- "статус git" → run_command("git status")
- "запусти docker compose" → run_command("docker compose up -d")`;
}

export class CommandAgent {
  private ai: AIService;
  private workspaceRoot: string;
  private toolLog: ToolCallLog[] = [];

  constructor(workspaceRoot?: string) {
    this.ai = new AIService();
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  async execute(userMessage: string): Promise<string> {
    this.toolLog = [];

    const tools = this.buildTools();
    const toolManifests = tools.map((t) => t.tool);

    const systemPrompt = buildSystemPrompt(this.workspaceRoot);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    while (true) {
      const response = await this.ai.completeWithTools(messages, toolManifests);
      const choice = response.choices[0];
      const message = choice.message;

      if (choice.finish_reason === "tool_calls" && message.tool_calls) {
        messages.push({
          role: "assistant",
          content: message.content || "",
          tool_calls: message.tool_calls,
        });

        for (const tc of message.tool_calls) {
          if (tc.type !== "function") continue;

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            /* skip */
          }

          const toolName = tc.function.name;
          console.log("[CommandAgent] " + toolName);

          if (toolName === "finish") {
            const answer = (args.answer || args.response || "") as string;
            return answer;
          }

          const tool = tools.find((t) => t.tool.function.name === toolName);
          let result = "Unknown tool: " + toolName;

          if (tool) {
            try {
              result = await tool.handler(args, this);
            } catch (e: any) {
              result = "Error: " + e.message;
            }
          }

          this.toolLog.push({ name: toolName, args, result });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result.slice(0, 4000),
          });

          // LoopDetector каждые 10 шагов
          if (this.toolLog.length > 0 && this.toolLog.length % 10 === 0) {
            const recentLogs = this.toolLog.slice(-5);
            const check = await this.checkLoop(userMessage, recentLogs);
            if (check.isLoop || check.shouldFinish) {
              return this.summarizeAndFinish(userMessage);
            }
          }
        }
        continue;
      }

      return message.content || "Нет ответа";
    }
  }

  private buildTools(): { tool: Tool; handler: (args: Record<string, unknown>, agent: CommandAgent) => Promise<string> }[] {
    return [
      {
        tool: {
          type: "function",
          function: {
            name: "run_command",
            description: "Выполнить shell-команду и вернуть результат. Блокирующий вызов — ждёт завершения команды.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "Shell-команда для выполнения" },
                timeout: { type: "number", description: "Таймаут в миллисекундах (по умолчанию 30000)" },
              },
              required: ["command"],
            },
          },
        },
        handler: async (args) => {
          const command = args.command as string;
          const timeout = (args.timeout as number) || 30000;

          // Проверка опасных команд
          const dangerous = ["rm -rf /", "sudo", "mkfs", "dd if=", ":(){:|:&};:", "chmod -R 777 /"];
          for (const d of dangerous) {
            if (command.includes(d)) {
              return `ОПАСНАЯ КОМАНДА: "${command}" может повредить систему. Отклонено.`;
            }
          }

          try {
            const startTime = Date.now();
            const result = execSync(command, {
              cwd: this.workspaceRoot,
              timeout,
              maxBuffer: 1024 * 1024, // 1MB
              encoding: "utf-8",
            });
            const durationMs = Date.now() - startTime;
            return `✓ Команда выполнена за ${durationMs}ms\n\n${result}`;
          } catch (e: any) {
            const exitCode = e.status || e.code || "unknown";
            const stdout = e.stdout || "";
            const stderr = e.stderr || e.message || "";
            return `✗ Команда завершилась с ошибкой (exit code: ${exitCode})\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`;
          }
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "run_command_async",
            description: "Запустить команду асинхронно (не ждать завершения). Для долгих процессов типа dev-серверов.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "Shell-команда" },
              },
              required: ["command"],
            },
          },
        },
        handler: async (args) => {
          const command = args.command as string;

          return new Promise((resolve) => {
            exec(command, { cwd: this.workspaceRoot }, (error, stdout, stderr) => {
              if (error) {
                resolve(`Async command failed: ${error.message}\nstderr: ${stderr}`);
              } else {
                resolve(`Async command completed:\n${stdout}`);
              }
            });
            // Не ждём завершения — сразу возвращаем
            resolve(`✓ Команда запущена асинхронно: ${command}`);
          });
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "list_files",
            description: "Получить список файлов в директории",
            parameters: {
              type: "object",
              properties: {
                dir: { type: "string", description: "Путь к директории (по умолчанию — рабочая директория)" },
              },
            },
          },
        },
        handler: async (args) => {
          const dir = (args.dir as string) || this.workspaceRoot;
          try {
            const result = execSync(`ls -la "${dir}"`, {
              cwd: this.workspaceRoot,
              timeout: 10000,
              encoding: "utf-8",
            });
            return result;
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "read_file",
            description: "Прочитать содержимое файла",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Путь к файлу" },
              },
              required: ["path"],
            },
          },
        },
        handler: async (args) => {
          const filePath = args.path as string;
          try {
            const fs = await import("node:fs");
            const fullPath = filePath.startsWith("/") ? filePath : this.workspaceRoot + "/" + filePath;
            return fs.readFileSync(fullPath, "utf-8");
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "finish",
            description: "Завершить диалог и вернуть финальный ответ пользователю",
            parameters: {
              type: "object",
              properties: {
                answer: { type: "string", description: "Финальный ответ" },
              },
              required: ["answer"],
            },
          },
        },
        handler: async (args) => {
          return (args.answer as string) || "Done";
        },
      },
    ];
  }

  private async checkLoop(
    userMessage: string,
    recentLogs: ToolCallLog[],
  ): Promise<{ isLoop: boolean; shouldFinish: boolean; reason: string }> {
    const logSummary = recentLogs
      .map((t, i) => `[${i + 1}] ${t.name}(${JSON.stringify(t.args)}) → ${t.result.slice(0, 300)}`)
      .join("\n");

    const prompt = `Ты — детектор зацикливания AI-агента.

ЗАДАЧА: ${userMessage}

ПОСЛЕДНИЕ ДЕЙСТВИЯ АГЕНТА:
${logSummary}

Проанализируй и ответь JSON:
{"loop": true/false, "finish": true/false, "reason": "почему"}

loop = true если: повторяющиеся вызовы с одинаковыми аргументами, агент ходит по кругу
finish = true если: достаточно данных для ответа, агент застрял и нужно остановиться`;

    try {
      const response = await this.ai.complete(
        "Ответь строго в формате JSON.",
        prompt,
        { temperature: 0.1, maxTokens: 300 },
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isLoop: parsed.loop === true,
          shouldFinish: parsed.finish === true,
          reason: parsed.reason || "",
        };
      }
    } catch (e) {
      console.error("[CommandAgent] LoopDetector error:", e);
    }

    return { isLoop: false, shouldFinish: false, reason: "" };
  }

  private async summarizeAndFinish(userMessage: string): Promise<string> {
    const logSummary = this.toolLog
      .map((t, i) => `[${i + 1}] ${t.name}:\n${t.result.slice(0, 400)}`)
      .join("\n\n");

    const prompt = `Вопрос: ${userMessage}

Результаты выполнения команд (${this.toolLog.length} шагов):
${logSummary}

Объясни результат пользователю на русском языке.`;

    try {
      return await this.ai.complete(
        "Ты — Command Agent. Объясни результат выполнения команд пользователю.",
        prompt,
        { temperature: 0.3, maxTokens: 4096 },
      );
    } catch (e) {
      console.error("[CommandAgent] summarizeAndFinish error:", e);
      return "Ошибка при формировании ответа.";
    }
  }
}
