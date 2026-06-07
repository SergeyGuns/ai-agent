import { describe, it, expect, beforeEach } from "vitest";
import { ObservabilityService } from "../services/observability/observability.service.js";

describe("ObservabilityService", () => {
  let obs: ObservabilityService;

  beforeEach(() => {
    obs = new ObservabilityService({
      tracer: { minLevel: "debug", enableConsole: false },
    });
  });

  describe("integration", () => {
    it("logs tool calls and updates metrics", () => {
      obs.logToolCall({
        agentId: "agent-1",
        toolName: "read_file",
        args: { path: "test.ts" },
        result: "content",
        durationMs: 50,
        success: true,
      });

      const toolMetrics = obs.metrics.getToolMetrics("read_file");
      expect(toolMetrics).toBeDefined();
      expect(toolMetrics!.calls).toBe(1);
      expect(toolMetrics!.avgDurationMs).toBe(50);

      const traceEntries = obs.tracer.getEntries();
      expect(traceEntries.length).toBe(1);
    });

    it("logs agent calls and updates metrics", () => {
      obs.logAgentCall({
        agentId: "agent-1",
        input: "question",
        output: "answer",
        durationMs: 100,
        tokensUsed: 500,
        tokensGenerated: 200,
      });

      const agentMetrics = obs.metrics.getAgentMetrics("agent-1");
      expect(agentMetrics).toBeDefined();
      expect(agentMetrics!.calls).toBe(1);
      expect(agentMetrics!.tokensUsed).toBe(500);
    });

    it("tracks tool errors in tool metrics", () => {
      obs.logToolCall({
        agentId: "agent-1",
        toolName: "read_file",
        args: {},
        result: "error",
        durationMs: 10,
        success: false,
      });

      const toolMetrics = obs.metrics.getToolMetrics("read_file");
      expect(toolMetrics!.errors).toBe(1);
    });

    it("tracks agent errors in system metrics", () => {
      obs.logAgentCall({
        agentId: "agent-1",
        input: "q",
        output: "err",
        durationMs: 10,
        error: true,
      });

      const sysMetrics = obs.metrics.getSystemMetrics();
      expect(sysMetrics.totalErrors).toBe(1);
    });
  });

  describe("OpenTelemetry export", () => {
    it("exports traces in OTel format", () => {
      const traceId = obs.tracer.startTrace("Test", "test operation");
      obs.tracer.info("Test", "info message", { traceId });

      const otel = obs.exportToOpenTelemetry();
      const parsed = JSON.parse(otel);

      expect(parsed.resourceSpans).toBeDefined();
      expect(parsed.resourceSpans.length).toBeGreaterThan(0);
      expect(parsed.metrics).toBeDefined();
    });

    it("includes service attributes in OTel export", () => {
      obs.tracer.startTrace("Test", "test");
      const otel = obs.exportToOpenTelemetry();
      const parsed = JSON.parse(otel);

      const firstSpan = parsed.resourceSpans[0].resourceSpans[0];
      expect(firstSpan.resource.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "service.name",
            value: { stringValue: "ai-agent" },
          }),
        ]),
      );
    });

    it("exports empty spans when no traces", () => {
      const otel = obs.exportToOpenTelemetry();
      const parsed = JSON.parse(otel);
      expect(parsed.resourceSpans).toBeDefined();
    });
  });

  describe("dashboard summary", () => {
    it("provides dashboard summary", () => {
      obs.logAgentCall({
        agentId: "agent-1",
        input: "q1",
        output: "a1",
        durationMs: 100,
      });
      obs.logAgentCall({
        agentId: "agent-2",
        input: "q2",
        output: "a2",
        durationMs: 200,
      });
      obs.logToolCall({
        agentId: "agent-1",
        toolName: "read_file",
        args: {},
        result: "ok",
        durationMs: 50,
        success: true,
      });

      const summary = obs.getDashboardSummary(2);

      // totalRequests = agent calls only (tool calls tracked separately)
      expect(summary.totalRequests).toBe(2);
      expect(summary.activeSessions).toBe(2);
      expect(summary.topAgents.length).toBe(2);
      expect(summary.topTools.length).toBe(1);
    });

    it("calculates error rate from agent errors", () => {
      obs.logAgentCall({
        agentId: "a1",
        input: "q1",
        output: "ok",
        durationMs: 10,
      });
      obs.logAgentCall({
        agentId: "a1",
        input: "q2",
        output: "err",
        durationMs: 10,
        error: true,
      });

      const summary = obs.getDashboardSummary();
      expect(summary.errorRate).toBe(0.5);
    });

    it("returns recent errors", () => {
      obs.tracer.error("Test", "error 1");
      obs.tracer.error("Test", "error 2");
      obs.tracer.info("Test", "info");

      const summary = obs.getDashboardSummary();
      expect(summary.recentErrors.length).toBe(2);
    });
  });

  describe("clear", () => {
    it("clears all data", () => {
      obs.tracer.info("Test", "msg");
      obs.metrics.recordAgentCall("a1", 100, 500, 200);

      obs.clear();

      expect(obs.tracer.getEntries().length).toBe(0);
      expect(obs.metrics.getSystemMetrics().totalRequests).toBe(0);
    });
  });
});
