import { describe, it, expect, beforeEach } from "vitest";
import { Tracer } from "../../services/observability/tracer.js";
import { Metrics } from "../../services/observability/metrics.js";

describe("Tracer", () => {
  let tracer: Tracer;

  beforeEach(() => {
    tracer = new Tracer({ minLevel: "debug", enableConsole: false });
  });

  it("should log info messages", () => {
    tracer.info("Test", "Hello");
    const entries = tracer.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].component).toBe("Test");
    expect(entries[0].message).toBe("Hello");
  });

  it("should filter by min level", () => {
    const t = new Tracer({ minLevel: "warn", enableConsole: false });
    t.debug("Test", "debug msg");
    t.info("Test", "info msg");
    t.warn("Test", "warn msg");
    t.error("Test", "error msg");
    expect(t.getEntries().length).toBe(2); // warn + error
  });

  it("should start a trace and return traceId", () => {
    const traceId = tracer.startTrace("Test", "start");
    expect(traceId).toMatch(/^trace-\d+-\d+$/);
    const trace = tracer.getTrace(traceId);
    expect(trace.length).toBe(1);
  });

  it("should log tool calls", () => {
    tracer.logToolCall({
      agentId: "agent-1",
      toolName: "read_file",
      args: { path: "test.ts" },
      result: "file content",
      durationMs: 50,
      success: true,
    });
    const entries = tracer.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].data?.toolName).toBe("read_file");
    expect(entries[0].data?.durationMs).toBe(50);
  });

  it("should log agent calls", () => {
    tracer.logAgentCall({
      agentId: "agent-1",
      input: "question",
      output: "answer",
      durationMs: 100,
    });
    const entries = tracer.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].data?.agentId).toBe("agent-1");
  });

  it("should export to JSON", () => {
    tracer.info("Test", "msg");
    const json = tracer.export();
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
  });

  it("should clear entries", () => {
    tracer.info("Test", "msg");
    tracer.clear();
    expect(tracer.getEntries().length).toBe(0);
  });
});

describe("Metrics", () => {
  let metrics: Metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  it("should record agent calls", () => {
    metrics.recordAgentCall("agent-1", 100, 500, 200);
    const m = metrics.getAgentMetrics("agent-1");
    expect(m).toBeDefined();
    expect(m!.calls).toBe(1);
    expect(m!.totalDurationMs).toBe(100);
    expect(m!.tokensUsed).toBe(500);
  });

  it("should accumulate agent calls", () => {
    metrics.recordAgentCall("agent-1", 100, 500, 200);
    metrics.recordAgentCall("agent-1", 200, 300, 100);
    const m = metrics.getAgentMetrics("agent-1");
    expect(m!.calls).toBe(2);
    expect(m!.totalDurationMs).toBe(300);
  });

  it("should record tool calls", () => {
    metrics.recordToolCall("read_file", 50);
    const m = metrics.getToolMetrics("read_file");
    expect(m).toBeDefined();
    expect(m!.calls).toBe(1);
    expect(m!.avgDurationMs).toBe(50);
    expect(m!.maxDurationMs).toBe(50);
  });

  it("should track tool errors", () => {
    metrics.recordToolCall("read_file", 50, true);
    const m = metrics.getToolMetrics("read_file");
    expect(m!.errors).toBe(1);
  });

  it("should compute system metrics", () => {
    metrics.recordAgentCall("a1", 100, 500, 200);
    metrics.recordAgentCall("a2", 200, 300, 100, true);
    const sys = metrics.getSystemMetrics(2);
    expect(sys.totalRequests).toBe(2);
    expect(sys.totalErrors).toBe(1);
    expect(sys.totalTokensUsed).toBe(800);
    expect(sys.activeSessions).toBe(2);
  });

  it("should export to JSON", () => {
    metrics.recordAgentCall("a1", 100, 500, 200);
    const json = metrics.export();
    const parsed = JSON.parse(json);
    expect(parsed.system).toBeDefined();
    expect(parsed.agents.length).toBe(1);
  });

  it("should reset all metrics", () => {
    metrics.recordAgentCall("a1", 100, 500, 200);
    metrics.reset();
    expect(metrics.getAgentMetrics("a1")).toBeUndefined();
    expect(metrics.getSystemMetrics().totalRequests).toBe(0);
  });
});
