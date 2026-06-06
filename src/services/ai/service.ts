import OpenAI from "openai";
import { z } from "zod";
import { ChatMessage } from "./types.js";
import { zodToJsonSchema } from "./zod-to-json-schema.js";
import { encoding_for_model, get_encoding } from "tiktoken";

// Получаем энкодер для модели (с fallback на cl100k_base)
function getEncoder(model: string) {
  try {
    return encoding_for_model(model as any);
  } catch {
    // Для неизвестных моделей используем cl100k_base (GPT-4/Claude-совместимый)
    return get_encoding("cl100k_base");
  }
}

// Подсчёт токенов в тексте
function countTokens(text: string, encoder: ReturnType<typeof getEncoder>): number {
  return encoder.encode(text).length;
}

// Подсчёт токенов в массиве сообщений
function countMessagesTokens(
  messages: ChatMessage[],
  encoder: ReturnType<typeof getEncoder>,
): number {
  let total = 0;
  for (const msg of messages) {
    total += countTokens(msg.content, encoder);
    // Добавляем токены для структуры сообщения (role, name и т.д.)
    total += 4; // ~4 токена на каждое сообщение
  }
  return total;
}

export class AIService {
  private client: OpenAI;
  private model: string;
  private encoder: ReturnType<typeof getEncoder>;
  private totalTokensUsed = 0;
  private totalTokensGenerated = 0;
  private requestCount = 0;

  constructor() {
    const { LLM_PROVIDER_BASE_URL, LLM_PROVIDER_API_KEY, LLM_PROVIDER_MODEL } =
      process.env;
    const baseURL = LLM_PROVIDER_BASE_URL || "http://localhost:1234/v1";
    const apiKey = LLM_PROVIDER_API_KEY || "ollama";
    this.model = LLM_PROVIDER_MODEL || "qwen/qwen3.6-35b-a3b";

    this.client = new OpenAI({ baseURL, apiKey });
    this.encoder = getEncoder(this.model);

    console.log("[AIService] Model: " + this.model);
    console.log("[AIService] URL: " + baseURL);
  }

  get rawClient(): OpenAI {
    return this.client;
  }

  get modelName(): string {
    return this.model;
  }

  get stats() {
    return {
      totalTokensUsed: this.totalTokensUsed,
      totalTokensGenerated: this.totalTokensGenerated,
      requestCount: this.requestCount,
    };
  }

  printStats() {
    console.log(
      "[Tokens] Input: " +
        this.totalTokensUsed +
        " | Output: " +
        this.totalTokensGenerated +
        " | Requests: " +
        this.requestCount +
        " | Total: " +
        (this.totalTokensUsed + this.totalTokensGenerated),
    );
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

    const inputTokens = countMessagesTokens(messages, this.encoder);
    this.requestCount++;
    this.totalTokensUsed += inputTokens;

    console.log("[Tokens] Request #" + this.requestCount + " input: " + inputTokens + " tokens");

    const response = await this.withRetry(() => this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      temperature: options?.temperature ?? 0.3,
      max_tokens: 4096,
    })) as any;

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty response");

    const outputTokens = countTokens(content, this.encoder);
    this.totalTokensGenerated += outputTokens;

    // Используем usage из ответа если доступен
    if (response.usage) {
      this.totalTokensUsed = response.usage.prompt_tokens;
      this.totalTokensGenerated = response.usage.completion_tokens;
      console.log(
        "[Tokens] Usage - Input: " +
          response.usage.prompt_tokens +
          " | Output: " +
          response.usage.completion_tokens +
          " | Total: " +
          response.usage.total_tokens,
      );
    } else {
      console.log("[Tokens] Output: " + outputTokens + " tokens (estimated)");
    }

    return content;
  }

  async completeWithTools(
    messages: ChatMessage[],
    tools?: OpenAI.Chat.ChatCompletionTool[],
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const inputTokens = countMessagesTokens(messages, this.encoder);
    this.requestCount++;

    // Считаем токены для tools
    let toolsTokens = 0;
    if (tools) {
      toolsTokens = countTokens(JSON.stringify(tools), this.encoder);
    }

    const totalInput = inputTokens + toolsTokens;
    this.totalTokensUsed += totalInput;

    console.log(
      "[Tokens] Request #" +
        this.requestCount +
        " input: " +
        totalInput +
        " tokens (messages: " +
        inputTokens +
        ", tools: " +
        toolsTokens +
        ")",
    );

    const response = await this.withRetry(() => this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      tools: tools,
      tool_choice: tools ? "auto" : undefined,
      temperature: 0.3,
      max_tokens: 4096,
    })) as any;

    // Используем usage из ответа если доступен
    if (response.usage) {
      this.totalTokensUsed += response.usage.prompt_tokens;
      this.totalTokensGenerated += response.usage.completion_tokens;
      console.log(
        "[Tokens] Usage - Input: " +
          response.usage.prompt_tokens +
          " | Output: " +
          response.usage.completion_tokens +
          " | Total: " +
          response.usage.total_tokens,
      );
    } else {
      const outputContent = response.choices[0]?.message?.content || "";
      const outputTokens = countTokens(outputContent, this.encoder);
      this.totalTokensGenerated += outputTokens;
      console.log("[Tokens] Output: " + outputTokens + " tokens (estimated)");
    }

    return response;
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

    const response = await this.withRetry(() => this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      temperature: options?.temperature ?? 0.1,
      max_tokens: 4096,
    })) as any;

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

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 2000): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastError = e;
        const isRetryable =
          e.status === 400 ||
          e.status === 429 ||
          e.status >= 500 ||
          e.message?.includes("Model reloaded") ||
          e.message?.includes("timeout") ||
          e.message?.includes("ECONNREFUSED");

        if (!isRetryable || attempt === maxRetries) throw e;

        const delay = baseDelayMs * attempt;
        console.log("[AIService] Retry " + attempt + "/" + maxRetries + " after " + delay + "ms: " + e.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
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
