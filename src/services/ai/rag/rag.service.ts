import { VectorStore } from "./vector-store.js";
import { AIService } from "../service.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class RAGService {
  private store: VectorStore;
  private ai: AIService;

  constructor(workspaceRoot: string) {
    this.store = new VectorStore(workspaceRoot);
    this.ai = new AIService();
  }

  get vectorStore(): VectorStore {
    return this.store;
  }

  async index(): Promise<void> {
    console.log("[RAG] Indexing project...");
    const files = await this.store.indexDirectory(this.store["workspaceRoot"]);
    console.log(
      `[RAG] Indexed ${files} files, ${this.store.size} total chunks`,
    );
  }

  async ask(question: string): Promise<string> {
    const results = await this.store.search(question, 5);

    if (results.length === 0) {
      return "Информация не найдена.";
    }

    const context = results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.filePath}:${r.startLine}-${r.endLine}\n${r.content}`,
      )
      .join("\n\n---\n\n");

    const systemPrompt =
      "Отвечай на вопрос на основе предоставленного контекста. " +
      "Если ответа нет — скажи об этом. Отвечай на русском.";

    const userPrompt = `Контекст:\n\n${context}\n\n---\n\nВопрос: ${question}`;

    return this.ai.complete(systemPrompt, userPrompt, { temperature: 0.2 });
  }
}
