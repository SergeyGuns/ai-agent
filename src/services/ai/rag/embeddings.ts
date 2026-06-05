import OpenAI from "openai";
import { Buffer } from "buffer";

export class EmbeddingService {
  private client: OpenAI;
  private model: string;

  constructor() {
    const baseURL =
      process.env.LLM_PROVIDER_BASE_URL || "http://localhost:1234/v1";
    const apiKey = process.env.LLM_PROVIDER_API_KEY || "ollama";
    this.model = process.env.LLM_PROVIDER_EMBEDDING_MODEL || "nomic-embed-text";

    this.client = new OpenAI({
      baseURL,
      apiKey,
    });

    console.log(`[EmbeddingService] Model: ${this.model}`);
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      // <<<<< IMPORTANT – ask for raw floats (no base64)
      encoding_format: "float",
    });

    // response.data[0] is already a number array
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      encoding_format: "float",
    });
    return response.data.map((d) => d.embedding);
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const mag = Math.sqrt(normA) * Math.sqrt(normB);
    return mag === 0 ? 0 : dot / mag;
  }
}
