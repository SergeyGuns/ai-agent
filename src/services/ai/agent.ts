import { AIService } from "./service.js";
import { ToolRegistry } from "./tools/registry.js";
import { ChatMessage, AgentConfig } from "./types.js";

const MAX_TOOL_OUTPUT = 1000;

export class Agent {
  private ai: AIService;
  private tools: ToolRegistry;
  private config: AgentConfig;

  constructor(config?: Partial<AgentConfig>) {
    this.ai = new AIService();
    const workspaceRoot = config?.workspaceRoot || process.cwd();
    this.tools = new ToolRegistry(workspaceRoot);

    this.config = {
      maxIterations: 100,
      systemPrompt:
        "Ты — ассистент разработчика.\n\n" +
        "ПРАВИЛА:\n" +
        "1. Для вопросов о коде вызови ask_codebase(question) ОДИН раз\n" +
        "2. Получив результат — сразу вызови finish(answer) с ответом\n" +
        "3. НЕ вызывай ask_codebase дважды\n" +
        "4. НЕ вызывай list_files после ask_codebase\n\n" +
        "Инструменты:\n" +
        "- ask_codebase(question) — поиск по коду\n" +
        "- read_file(path) — прочитать файл\n" +
        "- list_files(dir) — список файлов\n" +
        "- finish(answer) — завершить и дать ответ\n",
      workspaceRoot,
      ...config,
    };
  }

  async process(userMessage: string): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: userMessage },
    ];

    const toolManifests = this.tools.getToolManifests();
    let iterations = 0;
    const calledTools = new Set<string>();
    let askedCodebase = false;

    while (iterations < this.config.maxIterations) {
      iterations++;

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
              content: "ask_codebase уже вызывался. Используй предыдущий результат и вызови finish.",
            });
            continue;
          }

          if (tc.function.name === "list_files" && askedCodebase) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "НЕ вызывай list_files после ask_codebase. Вызови finish с ответом.",
            });
            continue;
          }

          const callKey = tc.function.name + ":" + JSON.stringify(args);
          if (calledTools.has(callKey)) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Уже вызывалось. Вызови finish.",
            });
            continue;
          }
          calledTools.add(callKey);

          console.log("[Tool] " + tc.function.name + "(" + JSON.stringify(args) + ")");

          if (tc.function.name === "finish") {
            return (args.answer || args.response || "") as string;
          }

          if (tc.function.name === "ask_codebase") {
            askedCodebase = true;
          }

          let result = await this.tools.execute(tc.function.name, args);

          if (result.length > MAX_TOOL_OUTPUT) {
            result = result.slice(0, MAX_TOOL_OUTPUT) + "\n... [обрезано]";
          }

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });

          if (tc.function.name === "ask_codebase") {
            console.log("[Agent] Forcing finish after ask_codebase");
            return result;
          }
        }
        continue;
      }

      return message.content || "Нет ответа";
    }

    return "Превышен лимит итераций";
  }
}
