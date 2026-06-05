import { ToolDefinition } from "../types.js";
import { VectorStore } from "../rag/vector-store.js";

let storeInstance: VectorStore | null = null;

// Позволяем передать уже проиндексированный store
export function setVectorStore(store: VectorStore): void {
  storeInstance = store;
}

export function createAskCodebaseTool(_workspaceRoot: string): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "ask_codebase",
        description:
          "Поиск по векторному хранилищу кода проекта. " +
          "Используй, когда пользователь задаёт вопрос о реализации, " +
          "логике или структуре кода (например: «Как работает ToolRegistry?»).",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "Вопрос о коде проекта (на русском)",
            },
          },
          required: ["question"],
        },
      },
    },
    handler: async (args): Promise<string> => {
      if (!storeInstance) {
        // Если store пока не инициализирован – сразу завершаем
        return 'Ошибка: база знаний не готова. Вызови finish(answer: "База не готова")';
      }

      const question = (args.question as string).trim();

      try {
        const results = await storeInstance.search(question, 5);

        if (results.length === 0) {
          return 'Ничего не найдено. Вызови finish(answer: "Информация не найдена")';
        }

        // Формируем человекочитаемый вывод
        const formatted = results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.filePath}:${r.startLine}-${r.endLine}\n${r.content}`,
          )
          .join("\n\n---\n\n");

        // Возвращаем контекст + инструкцию для агента
        return (
          `Найденные фрагменты кода:\n\n${formatted}\n\n` +
          `Пожалуйста, используй эту информацию, сформулируй ответ и вызови finish(answer: "...").`
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `Ошибка при поиске: ${msg}. Вызови finish(answer: "Ошибка поиска")`;
      }
    },
  };
}
