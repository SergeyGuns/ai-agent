import { ToolDefinition } from "../types.js";
import type { VectorStore } from "../rag/vector-store.js";

let vectorStore: VectorStore | null = null;

export function setVectorStore(store: VectorStore): void {
  vectorStore = store;
}

export function createAskCodebaseTool(): ToolDefinition {
  return {
    tool: {
      type: "function",
      function: {
        name: "ask_codebase",
        description: "Поиск по кодовой базе через RAG",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "Вопрос о коде" },
          },
          required: ["question"],
        },
      },
    },
    handler: async (args) => {
      if (!vectorStore) {
        return "Ошибка: база знаний не готова";
      }
      const results = await vectorStore.search(args.question as string, 5);
      if (results.length === 0) {
        return "Ничего не найдено";
      }
      return results
        .map((r, i) => "[" + (i + 1) + "] " + r.source + ":" + r.lineStart + "-" + r.lineEnd + "\n" + r.content + "\n---")
        .join("\n");
    },
  };
}
