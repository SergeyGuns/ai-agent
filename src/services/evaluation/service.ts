import { AIService } from "../ai/service.js";

// === Evaluation Types ===

export interface ToolCallEvaluation {
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  expectedTool?: string;
  correct: boolean; // Соответствует ли вызов ожидаемому
}

export interface IntentClassificationEvaluation {
  input: string;
  expectedIntent: string;
  actualIntent: string;
  confidence: number;
  method: string;
  correct: boolean;
}

export interface ResponseEvaluation {
  query: string;
  response: string;
  expectedResponse?: string;
  relevance: number;       // 0-1: насколько ответ релевантен запросу
  accuracy: number;        // 0-1: фактическая точность
  completeness: number;    // 0-1: полнота ответа
  overallScore: number;    // среднее значение
}

export interface EvaluationReport {
  timestamp: number;
  totalTests: number;
  passed: number;
  failed: number;
  toolCallAccuracy: number;
  intentAccuracy: number;
  responseQuality: number;
  details: {
    toolCalls: ToolCallEvaluation[];
    intents: IntentClassificationEvaluation[];
    responses: ResponseEvaluation[];
  };
}

// === Evaluation Service ===

export interface EvaluationOptions {
  aiService?: AIService;
  toolCallThreshold?: number;  // минимальная accuracy для tool calls (по умолчанию 0.8)
  intentThreshold?: number;    // минимальная accuracy для intent classification (по умолчанию 0.7)
}

export class EvaluationService {
  private ai: AIService;
  private toolCallThreshold: number;
  private intentThreshold: number;

  // Собранные данные для оценки
  private toolCallEvaluations: ToolCallEvaluation[] = [];
  private intentEvaluations: IntentClassificationEvaluation[] = [];
  private responseEvaluations: ResponseEvaluation[] = [];

  constructor(options?: EvaluationOptions) {
    this.ai = options?.aiService ?? new AIService();
    this.toolCallThreshold = options?.toolCallThreshold ?? 0.8;
    this.intentThreshold = options?.intentThreshold ?? 0.7;
  }

  // === Tool Call Evaluation ===

  /**
   * Записать результат tool call для последующей оценки
   */
  recordToolCall(
    toolName: string,
    args: Record<string, unknown>,
    success: boolean,
    durationMs: number,
    expectedTool?: string,
  ): void {
    const correct = expectedTool ? toolName === expectedTool : success;
    this.toolCallEvaluations.push({
      toolName,
      args,
      success,
      durationMs,
      expectedTool,
      correct,
    });
  }

  /**
   * Оценка точности tool calls (офлайн)
   */
  evaluateToolCalls(): { accuracy: number; passed: number; failed: number; threshold: number } {
    if (this.toolCallEvaluations.length === 0) {
      return { accuracy: 0, passed: 0, failed: 0, threshold: this.toolCallThreshold };
    }

    const passed = this.toolCallEvaluations.filter((e) => e.correct).length;
    const failed = this.toolCallEvaluations.length - passed;
    const accuracy = passed / this.toolCallEvaluations.length;

    return { accuracy, passed, failed, threshold: this.toolCallThreshold };
  }

  // === Intent Classification Evaluation ===

  /**
   * Записать результат классификации intent для последующей оценки
   */
  recordIntentClassification(
    input: string,
    expectedIntent: string,
    actualIntent: string,
    confidence: number,
    method: string,
  ): void {
    this.intentEvaluations.push({
      input,
      expectedIntent,
      actualIntent,
      confidence,
      method,
      correct: expectedIntent === actualIntent,
    });
  }

  /**
   * Оценка точности intent classification (офлайн)
   */
  evaluateIntentClassification(): { accuracy: number; passed: number; failed: number; threshold: number; byMethod: Record<string, number> } {
    if (this.intentEvaluations.length === 0) {
      return { accuracy: 0, passed: 0, failed: 0, threshold: this.intentThreshold, byMethod: {} };
    }

    const passed = this.intentEvaluations.filter((e) => e.correct).length;
    const failed = this.intentEvaluations.length - passed;
    const accuracy = passed / this.intentEvaluations.length;

    // Разбивка по методам классификации
    const byMethod: Record<string, { correct: number; total: number }> = {};
    for (const eval_ of this.intentEvaluations) {
      if (!byMethod[eval_.method]) {
        byMethod[eval_.method] = { correct: 0, total: 0 };
      }
      byMethod[eval_.method].total++;
      if (eval_.correct) byMethod[eval_.method].correct++;
    }

    const byMethodAccuracy: Record<string, number> = {};
    for (const [method, stats] of Object.entries(byMethod)) {
      byMethodAccuracy[method] = stats.correct / stats.total;
    }

    return { accuracy, passed, failed, threshold: this.intentThreshold, byMethod: byMethodAccuracy };
  }

  // === LLM-as-Judge Response Evaluation ===

  /**
   * Оценка качества ответа через LLM-as-judge (онлайн)
   */
  async evaluateResponse(query: string, response: string, expectedResponse?: string): Promise<ResponseEvaluation> {
    const judgePrompt = `Ты — оценщик качества AI-ответов. Оцени ответ по трём критериям:

ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
${query}

ОТВЕТ АГЕНТА:
${response}

${expectedResponse ? `ОЖИДАЕМЫЙ ОТВЕТ:\n${expectedResponse}\n` : ""}

Оцени по шкале 0.0-1.0:
1. relevance: насколько ответ релевантен запросу
2. accuracy: фактическая точность информации
3. completeness: полнота ответа (покрывает ли все аспекты запроса)

Ответь СТРОГО в формате JSON:
{"relevance": <0.0-1.0>, "accuracy": <0.0-1.0>, "completeness": <0.0-1.0>, "overallScore": <среднее>, "feedback": "краткий комментарий"}`;

    try {
      const judgeResponse = await this.ai.complete(
        "Ответь строго в формате JSON.",
        judgePrompt,
        { temperature: 0.1, maxTokens: 500 },
      );

      const jsonMatch = judgeResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const relevance = Math.min(1, Math.max(0, parsed.relevance ?? 0));
        const accuracy = Math.min(1, Math.max(0, parsed.accuracy ?? 0));
        const completeness = Math.min(1, Math.max(0, parsed.completeness ?? 0));
        const overallScore = (relevance + accuracy + completeness) / 3;

        const evaluation: ResponseEvaluation = {
          query,
          response,
          expectedResponse,
          relevance,
          accuracy,
          completeness,
          overallScore,
        };

        this.responseEvaluations.push(evaluation);
        return evaluation;
      }
    } catch (e) {
      console.error("[EvaluationService] LLM judge error:", e);
    }

    // Fallback: нулевая оценка при ошибке
    const fallback: ResponseEvaluation = {
      query,
      response,
      expectedResponse,
      relevance: 0,
      accuracy: 0,
      completeness: 0,
      overallScore: 0,
    };
    this.responseEvaluations.push(fallback);
    return fallback;
  }

  // === Full Report ===

  /**
   * Генерация полного отчёта об оценке
   */
  generateReport(): EvaluationReport {
    const toolResult = this.evaluateToolCalls();
    const intentResult = this.evaluateIntentClassification();

    // Среднее качество ответов
    let responseQuality = 0;
    if (this.responseEvaluations.length > 0) {
      responseQuality = this.responseEvaluations.reduce((sum, r) => sum + r.overallScore, 0) / this.responseEvaluations.length;
    }

    const totalTests = toolResult.passed + toolResult.failed + intentResult.passed + intentResult.failed;
    const totalPassed = toolResult.passed + intentResult.passed;
    const totalFailed = toolResult.failed + intentResult.failed;

    return {
      timestamp: Date.now(),
      totalTests,
      passed: totalPassed,
      failed: totalFailed,
      toolCallAccuracy: toolResult.accuracy,
      intentAccuracy: intentResult.accuracy,
      responseQuality,
      details: {
        toolCalls: [...this.toolCallEvaluations],
        intents: [...this.intentEvaluations],
        responses: [...this.responseEvaluations],
      },
    };
  }

  /**
   * Очистить все собранные данные
   */
  reset(): void {
    this.toolCallEvaluations = [];
    this.intentEvaluations = [];
    this.responseEvaluations = [];
  }

  /**
   * Проверка порогов качества (для CI/CD gate)
   */
  checkThresholds(): { passed: boolean; failures: string[] } {
    const failures: string[] = [];
    const toolResult = this.evaluateToolCalls();
    const intentResult = this.evaluateIntentClassification();

    if (toolResult.accuracy < this.toolCallThreshold) {
      failures.push(`Tool call accuracy ${(toolResult.accuracy * 100).toFixed(1)}% below threshold ${(this.toolCallThreshold * 100).toFixed(1)}%`);
    }
    if (intentResult.accuracy < this.intentThreshold) {
      failures.push(`Intent accuracy ${(intentResult.accuracy * 100).toFixed(1)}% below threshold ${(this.intentThreshold * 100).toFixed(1)}%`);
    }

    return { passed: failures.length === 0, failures };
  }

  /**
   * Экспорт отчёта в JSON
   */
  exportReport(): string {
    return JSON.stringify(this.generateReport(), null, 2);
  }
}
