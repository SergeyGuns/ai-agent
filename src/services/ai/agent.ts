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
      maxIterations: 3,
      systemPrompt:
        "Ты — ассистент разработчика.\n\n" +
        "Инструменты:\n" +
        "1. ask_codebase(question) — поиск по коду (вызывай ОДИН раз)\n" +
        "2. read_file(file_path) — прочитать файл\n" +
        "3. list_files(dir_path) — список файлов\n" +
        "4. run_command(command) — выполнить команду\n" +
        "5. finish(answer) — ЗАВЕРШИТЬ\n\n" +
        "ПОРЯДОК: ask_codebase → результат → finish → СТОП\n" +
        "НЕ вызывай ask_codebase дважды!\n" +
        "НЕ вызывай list_files после ask_codebase!\n",
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
    let askedCodebase = false; // Флаг что ask_codebase уже вызывался

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
            / skip /;
          }

          // Блокируем повторный ask_codebase
          if (tc.function.name === "ask_codebase" && askedCodebase) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content:
                "ask_codebase уже вызывался. Используй предыдущий результат и вызови finish.",
            });
            continue;
          }

          // Блокируем list_files после ask_codebase
          if (tc.function.name === "list_files" && askedCodebase) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content:
                "НЕ вызывай list_files после ask_codebase. Вызови finish с ответом.",
            });
            continue;
          }

          const callKey = `${tc.function.name}:${JSON.stringify(args)}`;
          if (calledTools.has(callKey)) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Уже вызывалось. Вызови finish.",
            });
            continue;
          }
          calledTools.add(callKey);

          console.log(`[Tool] ${tc.function.name}(${JSON.stringify(args)})`);

          // Если finish — сразу возвращаем
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
        }
        continue;
      }

      return message.content || "Нет ответа";
    }

    return "Превышен лимит итераций";
  }
}
