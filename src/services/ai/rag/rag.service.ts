import * as fs from "fs";
import * as path from "node:path";
import { EmbeddingService } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import { chunkText } from "./chunker.js";

export class RAGService {
  private rootDir: string;
  private embeddingService: EmbeddingService;
  public vectorStore: VectorStore;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.embeddingService = new EmbeddingService();
    this.vectorStore = new VectorStore(this.embeddingService);
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
