import { AIService } from "./service.js";
import { ToolRegistry } from "./tools/registry.js";
import { ChatMessage, AgentConfig } from "./types.js";
import { Tracer } from "../observability/tracer.js";
import { Metrics } from "../observability/metrics.js";

const MAX_TOOL_OUTPUT = 1000;

interface ToolCallLog {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

async function checkLoop(
  ai: AIService,
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
    const response = await ai.complete(
      "Ответь строго в формате JSON.",
      prompt,
      { temperature: 1, maxTokens: 300 },
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
    console.error("[LoopDetector] Error:", e);
  }

  return { isLoop: false, shouldFinish: false, reason: "" };
}

export class Agent {
  private ai: AIService;
  private tools: ToolRegistry;
  private config: AgentConfig;
  private tracer?: Tracer;
  private metrics?: Metrics;

  constructor(config?: Partial<AgentConfig>) {
    this.ai = new AIService();
    const workspaceRoot = config?.workspaceRoot || process.cwd();
    this.tools = new ToolRegistry(workspaceRoot);

    this.config = {
      maxIterations: 999,
      systemPrompt:
        "Ты — ассистент разработчика.\n\n" +
        "ПРАВИЛА:\n" +
        "1. Для вопросов о коде вызови ask_codebase(question) ОДИН раз\n" +
        "2. Получив результат — сразу вызови finish(answer) с ответом\n" +
        "3. НЕ вызывай ask_codebase дважды\n" +
        "4. Отвечай только на русском языке\n\n" +
        "Инструменты:\n" +
        "- ask_codebase(question) — поиск по коду RAG\n" +
        "- read_file(path) — прочитать файл\n" +
        "- list_files(dir) — список файлов\n" +
        "- run_command(cmd) — выполнить команду\n" +
        "- search_code(pattern) — поиск по коду\n" +
        "- write_file(path, content) — записать файл\n" +
        "- finish(answer) — завершить и дать ответ\n",
      workspaceRoot,
      ...config,
    };
  }

  /**
   * Установить Tracer для логирования
   */
  setTracer(tracer: Tracer): void {
    this.tracer = tracer;
  }

  /**
   * Установить Metrics для сбора метрик
   */
  setMetrics(metrics: Metrics): void {
    this.metrics = metrics;
  }

  async process(userMessage: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: userMessage },
    ];

    const toolManifests = this.tools.getToolManifests();
    const calledTools = new Set<string>();
    let askedCodebase = false;
    const toolLog: ToolCallLog[] = [];
    const LOOP_CHECK_INTERVAL = 10;
    const RECENT_LOGS_WINDOW = 5;

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

          if (tc.function.name === "ask_codebase" && askedCodebase) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "ask_codebase уже вызывался. Вызови finish.",
            });
            continue;
          }

          const callKey = tc.function.name + ":" + JSON.stringify(args);
          if (calledTools.has(callKey)) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Уже вызывалось с такими аргументами. Вызови finish.",
            });
            continue;
          }
          calledTools.add(callKey);

          this.tracer?.debug("Agent", "Tool call: " + tc.function.name, { args });

          if (tc.function.name === "finish") {
            return (args.answer || args.response || "") as string;
          }

          if (tc.function.name === "ask_codebase") {
            askedCodebase = true;
          }

          const toolStart = Date.now();
          let result: string;
          let toolError = false;
          try {
            result = await this.tools.execute(tc.function.name, args);
          } catch (e: any) {
            result = "Error: " + e.message;
            toolError = true;
          }
          const toolDurationMs = Date.now() - toolStart;

          // Трейсинг и метрики
          this.tracer?.logToolCall({
            agentId: "code-agent",
            toolName: tc.function.name,
            args,
            result,
            durationMs: toolDurationMs,
            success: !toolError,
          });
          this.metrics?.recordToolCall(tc.function.name, toolDurationMs, toolError);

          if (result.length > MAX_TOOL_OUTPUT) {
            result = result.slice(0, MAX_TOOL_OUTPUT) + "\n... [обрезано]";
          }

          toolLog.push({ name: tc.function.name, args, result });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });

          // LoopDetector каждые N шагов
          if (toolLog.length > 0 && toolLog.length % LOOP_CHECK_INTERVAL === 0) {
            const recentLogs = toolLog.slice(-RECENT_LOGS_WINDOW);
            console.log("[LoopDetector] Проверка после " + toolLog.length + " шагов...");
            const check = await checkLoop(this.ai, userMessage, recentLogs);
            console.log("[LoopDetector] loop=" + check.isLoop + " finish=" + check.shouldFinish + " reason=" + check.reason);

            if (check.isLoop || check.shouldFinish) {
              return this.summarizeAndFinish(userMessage, toolLog);
            }
          }
        }
        continue;
      }

      return message.content || "Нет ответа";
    }
  }

  private async summarizeAndFinish(userMessage: string, toolLog: ToolCallLog[]): Promise<string> {
    const logSummary = toolLog
      .map((t, i) => `[${i + 1}] ${t.name}:\n${t.result.slice(0, 400)}`)
      .join("\n\n");

    const prompt = `Вопрос: ${userMessage}

Собранная информация (${toolLog.length} шагов):
${logSummary}

Дай полный структурированный ответ на основе этих данных.`;

    try {
      return await this.ai.complete(
        "Ты — ассистент разработчика. Ответь на вопрос пользователя.",
        prompt,
        { temperature: 1, maxTokens: 4096 },
      );
    } catch (e) {
      console.error("[summarizeAndFinish] Error:", e);
      return "Ошибка при формировании ответа.";
    }
  }
}
