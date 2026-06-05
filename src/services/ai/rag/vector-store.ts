import { EmbeddingService } from "./embeddings.js";
import { chunkCode, walkFiles, Chunk } from "./chunker.js";
import path from "path";

interface StoredChunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  embedding: number[];
}

interface SearchResult {
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
}

export class VectorStore {
  private embeddings: EmbeddingService;
  private chunks: StoredChunk[] = [];
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.embeddings = new EmbeddingService();
    this.workspaceRoot = workspaceRoot;
  }

  async indexDirectory(dirPath: string): Promise<number> {
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".md"];
    let count = 0;

    for await (const { path: filePath, content } of walkFiles(
      dirPath,
      extensions,
    )) {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const chunks = chunkCode(content);
      const texts = chunks.map((c) => c.content);
      const vectors = await this.embeddings.embedBatch(texts);

      for (let i = 0; i < chunks.length; i++) {
        this.chunks.push({
          id: `${relativePath}:${chunks[i].startLine}`,
          filePath: relativePath,
          content: chunks[i].content,
          startLine: chunks[i].startLine,
          endLine: chunks[i].endLine,
          embedding: vectors[i],
        });
      }
      count++;
      console.log(`[Index] ${relativePath} → ${chunks.length} chunks`);
    }

    return count;
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddings.embed(query);

    console.log("[DEBUG] Query embedding length:", queryEmbedding.length);
    console.log("[DEBUG] Query embedding sample:", queryEmbedding.slice(0, 5));

    const results = this.chunks.map((chunk) => ({
      content: chunk.content,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      similarity: EmbeddingService.cosineSimilarity(
        queryEmbedding,
        chunk.embedding,
      ),
    }));

    if (this.chunks.length > 0) {
      console.log(
        "[DEBUG] First chunk embedding length:",
        this.chunks[0].embedding.length,
      );
      console.log(
        "[DEBUG] First chunk embedding sample:",
        this.chunks[0].embedding.slice(0, 5),
      );
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  get size(): number {
    return this.chunks.length;
  }
}
