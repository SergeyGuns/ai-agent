import { AIService } from "../service.js";

export class EmbeddingService {
  private ai: AIService;
  private model: string;

  constructor() {
    this.ai = new AIService();
    this.model = process.env.EMBEDDING_MODEL || "text-embedding-nomic-embed-text-v1.5";
    console.log("[EmbeddingService] Model: " + this.model);
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.ai.rawClient.embeddings.create({
      model: this.model,
      input: text,
    });

    if (!response.data || response.data.length === 0) {
      console.error("[EmbeddingService] Empty response:", JSON.stringify(response));
      throw new Error("Embedding model returned empty response");
    }

    return response.data[0].embedding;
  }
}
