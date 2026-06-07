/**
 * Deterministic Routing Validation (MS Reference Architecture: Experimentation → Productization).
 *
 * Golden dataset для regression testing роутинга.
 * Используется в CI/CD pipeline как gate: accuracy < threshold = fail build.
 *
 * Запуск: npx vitest run src/tests/routing-validation.test.ts
 */

import { describe, it, expect } from "vitest";
import { SemanticRouter } from "../orchestrator/classifier.js";
import { GOLDEN_INTENT_DATASET, runOfflineEvaluation } from "../services/evaluation/middleware.js";
import { EvaluationService } from "../services/evaluation/service.js";

/**
 * CI/CD Gate: минимальная допустимая accuracy роутинга.
 * При падении ниже этого порога — build должен fail.
 */
const CI_ACCURACY_THRESHOLD = 0.65;

describe("Routing Validation — CI/CD Gate", () => {
  describe("Golden Dataset", () => {
    it("has comprehensive coverage", () => {
      // Проверяем что golden set покрывает все основные intents
      const intents = new Set(GOLDEN_INTENT_DATASET.map((d) => d.expectedIntent));
      const expectedIntents = [
        "web-search", "web-scrape", "browser", "fact-check",
        "file-list", "file-read", "code-search", "rag-query", "general",
      ];

      for (const intent of expectedIntents) {
        expect(intents.has(intent)).toBe(true);
      }
    });

    it("accuracy meets CI threshold (" + (CI_ACCURACY_THRESHOLD * 100) + "%)", async () => {
      const service = new EvaluationService();
      const result = await runOfflineEvaluation(service);

      console.log("[Routing Validation] Accuracy: " + (result.accuracy * 100).toFixed(1) + "%");
      console.log("[Routing Validation] Passed: " + result.passed + "/" + result.totalTests);

      if (result.failures.length > 0) {
        console.log("[Routing Validation] Failures:");
        for (const f of result.failures) {
          console.log('  "' + f.input + '" → expected: ' + f.expected + ", got: " + f.actual);
        }
      }

      expect(result.accuracy).toBeGreaterThanOrEqual(CI_ACCURACY_THRESHOLD);
    });
  });

  describe("SemanticRouter deterministic behavior", () => {
    it("returns consistent results for same input", async () => {
      const router = new SemanticRouter({ llmFallback: false });
      const results = await Promise.all([
        router.classify("Найди информацию о React"),
        router.classify("Найди информацию о React"),
        router.classify("Найди информацию о React"),
      ]);

      // Все три результта должны быть идентичны
      expect(results[0].intent).toBe(results[1].intent);
      expect(results[1].intent).toBe(results[2].intent);
      expect(results[0].confidence).toBe(results[1].confidence);
    });

    it("classifies web-search correctly", async () => {
      const router = new SemanticRouter({ llmFallback: false });
      const result = await router.classify("поиск информации в интернете");

      expect(result.intent).toBe("web-search");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("classifies code-search correctly", async () => {
      const router = new SemanticRouter({ llmFallback: false });
      const result = await router.classify("найди функцию calculateTotal");

      expect(result.intent).toBe("code-search");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("classifies file operations correctly", async () => {
      const router = new SemanticRouter({ llmFallback: false });
      const resultList = await router.classify("покажи список файлов");
      const resultRead = await router.classify("прочитай файл README");

      expect(resultList.intent).toBe("file-list");
      expect(resultRead.intent).toBe("file-read");
    });

    it("falls back to general for unknown input", async () => {
      const router = new SemanticRouter({ llmFallback: false });
      const result = await router.classify("asdfghjkl");

      // Should return general or fallback with low confidence
      expect(result.confidence).toBeLessThan(0.6);
    });
  });
});
