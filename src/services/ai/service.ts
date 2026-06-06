import OpenAI from "openai";
import { z } from "zod";
import { ChatMessage } from "./types.js";
import { zodToJsonSchema } from "./zod-to-json-schema.js";

export class AIService {
  private client: OpenAI;
  private model: string;
  constructor() {
    const { LLM_PROVIDER_BASE_URL, LLM_PROVIDER_API_KEY, LLM_PROVIDER_MODEL } =
      process.env;
    console.log({
      LLM_PROVIDER_BASE_URL,
      LLM_PROVIDER_API_KEY,
      LLM_PROVIDER_MODEL,
    });
    const baseURL = LLM_PROVIDER_BASE_URL || "http://localhost:1234/v1";
    const apiKey = LLM_PROVIDER_API_KEY || "ollama";
    this.model = LLM_PROVIDER_MODEL || "qwen/qwen3.6-35b-a3b";

    this.client = new OpenAI({ baseURL, apiKey });

    console.log({ Model: `${this.model}` });
    console.log({ URL: `${baseURL}` });
  }

  get rawClient(): OpenAI {
    return this.client;
  }

  get modelName(): string {
    return this.model;
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      temperature: options?.temperature ?? 0.3,
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty response");
    return content;
  }

  async completeWithTools(
    messages: ChatMessage[],
    tools?: OpenAI.Chat.ChatCompletionTool[],
  ): Promise<OpenAI.Chat.ChatCompletion> {
    return this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      tools: tools,
      tool_choice: tools ? "auto" : undefined,
      temperature: 0.3,
      max_tokens: 4096,
    }) as any;
  }

  async structured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T>,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<T> {
    const jsonSchema = zodToJsonSchema(schema);
    const schemaInstruction = `\n\nОтветь СТРОГО в формате JSON, соответствующей следующей JSON Schema:\n\n${JSON.stringify(jsonSchema, null, 2)}\n\nНе добавляй никакого текста до или после JSON.`;
    const fullSystemPrompt = systemPrompt + schemaInstruction;

    const messages: ChatMessage[] = [
      { role: "system", content: fullSystemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      temperature: options?.temperature ?? 0.1,
      max_tokens: 4096,
    });

    let jsonText = response.choices[0]?.message?.content?.trim();
    if (!jsonText) throw new Error("LLM returned empty response");

    jsonText = this.cleanJsonOutput(jsonText);
    const parsed: unknown = JSON.parse(jsonText);

    const result = schema.safeParse(parsed);
    if (!result.success) {
      console.error("[AIService] Validation error:", result.error.format());
      throw new Error(
        `Validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      );
    }
    return result.data;
  }

  async *streamComplete(
    systemPrompt: string,
    userPrompt: string,
    options?: { temperature?: number },
  ): AsyncIterable<string> {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  private cleanJsonOutput(text: string): string {
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n```$/, "");
    }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
    return text.trim();
  }
}
