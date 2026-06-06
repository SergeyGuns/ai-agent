import { EmbeddingService } from "./embeddings.js";

export interface Chunk {
  id: string;
  content: string;
  source: string;
  lineStart: number;
  lineEnd: number;
  embedding: number[];
}

export class VectorStore {
  private chunks: Chunk[] = [];
  private embeddings: EmbeddingService;

  constructor(embeddings: EmbeddingService) {
    this.embeddings = embeddings;
  }

  async addChunk(content: string, source: string, lineStart: number, lineEnd: number): Promise<void> {
    const embedding = await this.embeddings.embed(content);
    this.chunks.push({
      id: source + ":" + lineStart + "-" + lineEnd,
      content,
      source,
      lineStart,
      lineEnd,
      embedding,
    });
  }

  async search(query: string, topK: number = 5): Promise<Chunk[]> {
    const queryEmbedding = await this.embeddings.embed(query);
    const scored = this.chunks.map((chunk) => ({
      chunk,
      score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.chunk);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  get size(): number {
    return this.chunks.length;
  }
}
