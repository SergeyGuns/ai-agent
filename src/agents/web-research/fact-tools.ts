import type { AIService } from "../../services/ai/service.js";

export interface FactCheckResult {
  claim: string;
  verdict: "confirmed" | "refuted" | "unverified" | "contradictory";
  confidence: number;
  reasoning: string;
  sources: string[];
}

export async function verifyFact(
  ai: AIService,
  claim: string,
  sources: string[],
): Promise<FactCheckResult> {
  const prompt = `ФАКТ: ${claim}

ИСТОЧНИКИ:
${sources.map((s, i) => `[${i + 1}] ${s}`).join("\n")}

Проверь факт на основе источников. Ответь JSON:
{"verdict": "confirmed/refuted/unverified/contradictory", "confidence": 0.0-1.0, "reasoning": "объяснение"}`;

  try {
    const response = await ai.complete("Ты — фактчекер. Ответь строго JSON.", prompt, {
      temperature: 1,
      maxTokens: 500,
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        claim,
        verdict: parsed.verdict || "unverified",
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || "",
        sources,
      };
    }
  } catch (e) {
    console.error("[verifyFact] Error:", e);
  }

  return { claim, verdict: "unverified", confidence: 0, reasoning: "Ошибка при проверке", sources };
}

export async function crossReference(
  ai: AIService,
  query: string,
  results: string[],
): Promise<string> {
  const prompt = `Запрос: ${query}

Результаты из разных источников:
${results.map((r, i) => `=== Источник ${i + 1} ===\n${r.slice(0, 1000)}`).join("\n\n")}

Сравни информацию:
1. Что совпадает?
2. Что противоречит?
3. Какой консенсус?`;

  return ai.complete("Ты — аналитик. Сравни информацию из источников.", prompt, {
    temperature: 1,
    maxTokens: 2048,
  });
}

export async function summarizeSources(
  ai: AIService,
  sources: string[],
  query: string,
): Promise<string> {
  const prompt = `Запрос: ${query}

Собранные источники:
${sources.map((s, i) => `=== Источник ${i + 1} ===\n${s.slice(0, 1500)}`).join("\n\n")}

Напиши структурированный ответ на запрос, используя информацию из источников.`;

  return ai.complete("Ты — исследователь. Напиши структурированный ответ.", prompt, {
    temperature: 1,
    maxTokens: 4096,
  });
}
