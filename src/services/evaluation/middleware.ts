/**
 * EvaluationMiddleware — автоматический сбор данных для evaluation при каждом agent call.
 *
 * Реализует Evaluation Feedback Loop из MS Reference Architecture:
 * Offline Evaluation → Deploy → Online Evaluation → Dataset Enrichment → Iteration
 *
 * Middleware собирает:
 * - Tool call accuracy (правильный ли tool выбран)
 * - Intent classification accuracy
 * - Response quality (через LLM-as-judge, опционально)
 * - Performance metrics (duration, token usage)
 */

import { EvaluationService, EvaluationReport } from "../evaluation/service.js";
import { SemanticRouter } from "../../orchestrator/classifier.js";
import { Tracer } from "../../services/observability/tracer.js";

export interface MiddlewareOptions {
  /** Включить LLM-as-judge response evaluation (дорого, по умолчанию false) */
  enableLLMJudge?: boolean;
  /** Порог для автоматического алерта (0-1) */
  alertThreshold?: number;
  /** Количество записей перед автоматической оценкой */
  autoEvalBatchSize?: number;
}

const DEFAULT_OPTIONS: Required<MiddlewareOptions> = {
  enableLLMJudge: false,
  alertThreshold: 0.5,
  autoEvalBatchSize: 50,
};

/**
 * Создаёт middleware-обёртку для автоматической записи evaluation данных.
 * Оборачивает handler агента, добавляя pre/post логику.
 */
export function withEvaluation(
  agentId: string,
  evaluationService: EvaluationService,
  tracer: Tracer,
  options?: MiddlewareOptions,
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    /**
     * Записать tool call в evaluation после выполнения.
     */
    recordToolCall(
      toolName: string,
      args: Record<string, unknown>,
      success: boolean,
      durationMs: number,
      expectedTool?: string,
    ): void {
      evaluationService.recordToolCall(toolName, args, success, durationMs, expectedTool);
    },

    /**
     * Записать intent classification в evaluation.
     */
    recordIntentClassification(
      input: string,
      expectedIntent: string,
      actualIntent: string,
      confidence: number,
      method: string,
    ): void {
      evaluationService.recordIntentClassification(input, expectedIntent, actualIntent, confidence, method);
    },

    /**
     * Записать ответ для LLM-as-judge оценки (async).
     */
    async recordResponse(query: string, response: string): Promise<void> {
      if (opts.enableLLMJudge) {
        await evaluationService.evaluateResponse(query, response);
      }
    },

    /**
     * Проверить пороги качества и вернуть результат.
     */
    checkQuality(): { passed: boolean; failures: string[] } {
      const result = evaluationService.checkThresholds();

      if (!result.passed) {
        for (const failure of result.failures) {
          tracer.warn("EvaluationMiddleware", failure, { agentId });
        }
      }

      return result;
    },

    /**
     * Генерация полного отчёта.
     */
    generateReport(): EvaluationReport {
      return evaluationService.generateReport();
    },

    /**
     * Экспорт отчёта в JSON-строку.
     */
    exportReport(): string {
      return evaluationService.exportReport();
    },

    /**
     * Сброс всех собранных данных (для нового цикла оценки).
     */
    reset(): void {
      evaluationService.reset();
    },

    /**
     * Получить сервис напрямую (для кастомных сценариев).
     */
    getService(): EvaluationService {
      return evaluationService;
    },
  };
}

export type EvaluationMiddleware = ReturnType<typeof withEvaluation>;

/**
 * Golden Dataset для детерминистичной валидации роутинга.
 * Используется в CI/CD pipeline для regression testing.
 */
export const GOLDEN_INTENT_DATASET: Array<{
  input: string;
  expectedIntent: string;
  expectedCapability: string;
}> = [
  // Web search
  { input: "Найди информацию о TypeScript", expectedIntent: "web-search", expectedCapability: "web-search" },
  { input: "Что нового в React 19?", expectedIntent: "web-search", expectedCapability: "web-search" },
  { input: "поиск в интернете", expectedIntent: "web-search", expectedCapability: "web-search" },
  // Web scrape
  { input: "Загрузи страницу https://example.com", expectedIntent: "web-scrape", expectedCapability: "web-scrape" },
  { input: "парсинг сайта", expectedIntent: "web-scrape", expectedCapability: "web-scrape" },
  // Browser
  { input: "Открой сайт в браузере", expectedIntent: "browser", expectedCapability: "browser" },
  { input: "Сделай скриншот страницы", expectedIntent: "browser", expectedCapability: "browser" },
  // Fact check
  { input: "Проверь факт: Земля плоская", expectedIntent: "fact-check", expectedCapability: "fact-check" },
  { input: "Вернифицируй эту информацию", expectedIntent: "fact-check", expectedCapability: "fact-check" },
  // Code
  { input: "Найди функцию calculateTotal", expectedIntent: "code-search", expectedCapability: "code-search" },
  { input: "Как работает класс UserManager?", expectedIntent: "code-search", expectedCapability: "code-search" },
  // File operations
  { input: "Покажи список файлов", expectedIntent: "file-list", expectedCapability: "file-list" },
  { input: "Прочитай файл README.md", expectedIntent: "file-read", expectedCapability: "file-read" },
  // RAG
  { input: "Найди в документации", expectedIntent: "rag-query", expectedCapability: "retrieval" },
  { input: "Поиск по базе знаний", expectedIntent: "rag-query", expectedCapability: "retrieval" },
  // General
  { input: "Привет, как дела?", expectedIntent: "general", expectedCapability: "general" },
];

/**
 * Запустить offline evaluation на golden dataset.
 * Возвращает accuracy и детали по каждому тесту.
 */
export async function runOfflineEvaluation(
  evaluationService: EvaluationService,
): Promise<{
  accuracy: number;
  totalTests: number;
  passed: number;
  failed: number;
  failures: Array<{ input: string; expected: string; actual: string }>;
}> {
  const router = new SemanticRouter({ llmFallback: false }); // Только keyword, для детерминизма
  const failures: Array<{ input: string; expected: string; actual: string }> = [];
  let passed = 0;

  for (const testCase of GOLDEN_INTENT_DATASET) {
    const result = await router.classify(testCase.input);
    const capability = SemanticRouter.resolveCapability(result.intent);
    const correct = capability === testCase.expectedCapability;

    evaluationService.recordIntentClassification(
      testCase.input,
      testCase.expectedIntent,
      result.intent,
      result.confidence,
      result.method,
    );

    if (correct) {
      passed++;
    } else {
      failures.push({
        input: testCase.input,
        expected: testCase.expectedCapability,
        actual: capability,
      });
    }
  }

  return {
    accuracy: passed / GOLDEN_INTENT_DATASET.length,
    totalTests: GOLDEN_INTENT_DATASET.length,
    passed,
    failed: GOLDEN_INTENT_DATASET.length - passed,
    failures,
  };
}
