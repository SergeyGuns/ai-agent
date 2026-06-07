import * as fs from "fs";
import * as path from "node:path";
import { EmbeddingService } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { chunkText } from "./chunker.js";
import { LongTermMemory } from "../../memory/long-term-memory.js";

export class RAGService {
  private rootDir: string;
  private embeddingService: EmbeddingService;
  public vectorStore: VectorStore;
  /** Long-Term Memory для query-time enrichment */
  private ltm: LongTermMemory;

  constructor(rootDir: string, ltm?: LongTermMemory) {
    this.rootDir = rootDir;
    this.embeddingService = new EmbeddingService();
    this.vectorStore = new VectorStore(this.embeddingService);
    this.ltm = ltm ?? new LongTermMemory();
  }

  /**
   * Получить LTM для записи фактов из агентов.
   */
  getLTM(): LongTermMemory {
    return this.ltm;
  }

  async index(): Promise<void> {
    console.log("[RAG] Indexing project...");
    const files = this.collectFiles(this.rootDir);
    let totalChunks = 0;

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(this.rootDir, file);
      const chunks = chunkText(content);

      for (const chunk of chunks) {
        await this.vectorStore.addChunk(chunk.content, relativePath, chunk.lineStart, chunk.lineEnd);
        totalChunks++;
      }

      console.log("[Index] " + relativePath + " -> " + chunks.length + " chunks");
    }

    console.log("[RAG] Indexed " + files.length + " files, " + totalChunks + " total chunks");
  }

  /**
   * Query RAG с enrichment из Long-Term Memory.
   * Возвращает найденные чанки + контекст из LTM.
   */
  async query(question: string): Promise<{
    chunks: Array<{ content: string; source: string; lineStart: number; lineEnd: number }>;
    ltmContext: string;
  }> {
    // Поиск по векторному хранилищу
    const vectorResults = await this.vectorStore.search(question, 5);
    const chunks = vectorResults.map((r) => ({
      content: r.content,
      source: r.source,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
    }));

    // Enrichment из LTM
    const ltmContext = this.ltm.buildContext(question);

    return { chunks, ltmContext };
  }

  /**
   * Добавить факт в LTM (вызывается агентами после обработки).
   */
  addFact(content: string, opts?: {
    tags?: string[];
    confidence?: number;
    createdBy?: string;
    source?: string;
  }): void {
    this.ltm.addFact(content, opts);
  }

  /**
   * Сохранить LTM на диск.
   */
  persistLTM(path: string): void {
    const data = this.ltm.serialize();
    fs.writeFileSync(path, data, "utf-8");
  }

  /**
   * Загрузить LTM с диска.
   */
  loadLTM(path: string): void {
    try {
      const raw = fs.readFileSync(path, "utf-8");
      this.ltm = LongTermMemory.deserialize(raw);
    } catch {
      // Файл не найден — используем пустую LTM
      this.ltm = new LongTermMemory();
    }
  }

  /**
   * Собрать файлы для индексации
   */
  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
        results.push(...this.collectFiles(fullPath));
      } else if (entry.isFile() && /\.(ts|js|json|md|yaml|yml)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }

    return results;
  }
}
