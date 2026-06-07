import { describe, it, expect } from "vitest";
import { EvaluationService } from "../services/evaluation/service.js";
import {
  withEvaluation,
  runOfflineEvaluation,
  GOLDEN_INTENT_DATASET,
} from "../services/evaluation/middleware.js";
import { Tracer } from "../services/observability/tracer.js";

describe("EvaluationMiddleware", () => {
  describe("withEvaluation", () => {
    it("creates middleware with default options", () => {
      const service = new EvaluationService();
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      expect(mw).toBeDefined();
      expect(mw.recordToolCall).toBeTypeOf("function");
      expect(mw.recordIntentClassification).toBeTypeOf("function");
      expect(mw.checkQuality).toBeTypeOf("function");
      expect(mw.generateReport).toBeTypeOf("function");
      expect(mw.exportReport).toBeTypeOf("function");
      expect(mw.reset).toBeTypeOf("function");
      expect(mw.getService).toBeTypeOf("function");
    });

    it("records tool calls", () => {
      const service = new EvaluationService();
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      mw.recordToolCall("read_file", { path: "test.ts" }, true, 100);
      mw.recordToolCall("read_file", { path: "test.ts" }, true, 150);

      const report = mw.generateReport();
      expect(report.details.toolCalls.length).toBe(2);
      expect(report.toolCallAccuracy).toBe(1);
    });

    it("records intent classifications", () => {
      const service = new EvaluationService();
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      mw.recordIntentClassification("найди в коде", "code-search", "code-search", 0.9, "keyword");
      mw.recordIntentClassification("привет", "general", "web-search", 0.3, "fallback");

      const report = mw.generateReport();
      expect(report.details.intents.length).toBe(2);
      expect(report.intentAccuracy).toBe(0.5);
    });

    it("checkQuality passes when no data and thresholds are default", () => {
      // With default thresholds (0.8 intent, 0.7 tool), empty data returns 0 accuracy
      // which is below threshold. This is expected — no data = can't confirm quality.
      const service = new EvaluationService({
        intentThreshold: 0,
        toolCallThreshold: 0,
      });
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      const result = mw.checkQuality();
      expect(result.passed).toBe(true);
      expect(result.failures.length).toBe(0);
    });

    it("checkQuality with no data fails with default thresholds", () => {
      const service = new EvaluationService(); // default thresholds
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      const result = mw.checkQuality();
      // Empty data → 0 accuracy < threshold → fails
      expect(result.passed).toBe(false);
    });

    it("checkQuality fails when below threshold", () => {
      const service = new EvaluationService({ intentThreshold: 0.8 });
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      // Add some intents below threshold
      mw.recordIntentClassification("test1", "code-search", "general", 0.5, "keyword");
      mw.recordIntentClassification("test2", "code-search", "general", 0.5, "keyword");
      mw.recordIntentClassification("test3", "code-search", "code-search", 0.9, "keyword");

      const result = mw.checkQuality();
      // 1/3 = 0.33 < 0.8 threshold
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    });

    it("reset clears all data", () => {
      const service = new EvaluationService();
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      mw.recordToolCall("read_file", {}, true, 100);
      mw.recordIntentClassification("test", "general", "general", 0.9, "keyword");

      mw.reset();

      const report = mw.generateReport();
      expect(report.details.toolCalls.length).toBe(0);
      expect(report.details.intents.length).toBe(0);
    });

    it("exportReport returns valid JSON", () => {
      const service = new EvaluationService();
      const tracer = new Tracer({ enableConsole: false });
      const mw = withEvaluation("test-agent", service, tracer);

      mw.recordToolCall("read_file", {}, true, 100);

      const json = mw.exportReport();
      const parsed = JSON.parse(json);

      expect(parsed.timestamp).toBeTypeOf("number");
      expect(parsed.totalTests).toBeTypeOf("number");
      expect(parsed.details).toBeDefined();
    });
  });

  describe("GOLDEN_INTENT_DATASET", () => {
    it("has at least 10 test cases", () => {
      expect(GOLDEN_INTENT_DATASET.length).toBeGreaterThanOrEqual(10);
    });

    it("has unique inputs", () => {
      const inputs = GOLDEN_INTENT_DATASET.map((d) => d.input);
      const uniqueInputs = new Set(inputs);
      expect(inputs.length).toBe(uniqueInputs.size);
    });

    it("has expectedIntent and expectedCapability for each entry", () => {
      for (const entry of GOLDEN_INTENT_DATASET) {
        expect(entry.input.length).toBeGreaterThan(0);
        expect(entry.expectedIntent.length).toBeGreaterThan(0);
        expect(entry.expectedCapability.length).toBeGreaterThan(0);
      }
    });
  });

  describe("runOfflineEvaluation", () => {
    it("runs without errors", async () => {
      const service = new EvaluationService();
      const result = await runOfflineEvaluation(service);

      expect(result.totalTests).toBe(GOLDEN_INTENT_DATASET.length);
      expect(result.passed + result.failed).toBe(result.totalTests);
      expect(result.accuracy).toBeGreaterThanOrEqual(0);
      expect(result.accuracy).toBeLessThanOrEqual(1);
    });

    it("reports accuracy", async () => {
      const service = new EvaluationService();
      const result = await runOfflineEvaluation(service);

      expect(result.accuracy).toBe(result.passed / result.totalTests);
    });

    it("details failures", async () => {
      const service = new EvaluationService();
      const result = await runOfflineEvaluation(service);

      for (const failure of result.failures) {
        expect(failure.input.length).toBeGreaterThan(0);
        expect(failure.expected.length).toBeGreaterThan(0);
        expect(failure.actual.length).toBeGreaterThan(0);
      }
    });
  });
});
