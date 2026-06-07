import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistryMonitor, AgentHealth } from "../registry/monitor.js";
import { AgentDescriptor } from "../orchestrator/types.js";

// === Helpers ===

function createMockAgent(id: string, handler: AgentDescriptor["handler"]): AgentDescriptor {
  return {
    id,
    name: id,
    type: "local",
    capabilities: ["test"],
    handler,
    version: "1.0.0",
    status: "active",
  };
}

function createFailingAgent(id: string, errorMsg = "fail"): AgentDescriptor {
  return createMockAgent(id, async () => {
    throw new Error(errorMsg);
  });
}

function createSlowAgent(id: string, delayMs: number): AgentDescriptor {
  return createMockAgent(id, async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { agentId: id, content: "ok", confidence: 1 };
  });
}

// === Tests ===

describe("RegistryMonitor", () => {
  describe("registerAgent / unregisterAgent", () => {
    it("registers agent with initial health", () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("test-agent", async () => ({
        agentId: "test-agent",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      const health = monitor.getAgentHealth("test-agent");
      expect(health).toBeDefined();
      expect(health!.agentId).toBe("test-agent");
      expect(health!.status).toBe("active");
      expect(health!.consecutiveFailures).toBe(0);
      expect(health!.totalChecks).toBe(0);
    });

    it("unregisters agent", () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("test-agent", async () => ({
        agentId: "test-agent",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);
      monitor.unregisterAgent("test-agent");

      expect(monitor.getAgentHealth("test-agent")).toBeUndefined();
    });
  });

  describe("recordAgentCall", () => {
    it("records successful call", () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      monitor.recordAgentCall("a1", true, 100);

      const health = monitor.getAgentHealth("a1")!;
      expect(health.totalChecks).toBe(1);
      expect(health.consecutiveFailures).toBe(0);
      expect(health.status).toBe("active");
      expect(health.avgResponseMs).toBeGreaterThan(0);
    });

    it("records failed call", () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      monitor.recordAgentCall("a1", false, 50, "timeout");

      const health = monitor.getAgentHealth("a1")!;
      expect(health.totalChecks).toBe(1);
      expect(health.consecutiveFailures).toBe(1);
      expect(health.totalFailures).toBe(1);
      expect(health.lastError).toBe("timeout");
    });

    it("degrades agent after maxConsecutiveFailures", () => {
      const monitor = new RegistryMonitor({ maxConsecutiveFailures: 3 });
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      // 2 failures — still active
      monitor.recordAgentCall("a1", false, 10, "err1");
      monitor.recordAgentCall("a1", false, 10, "err2");
      expect(monitor.getAgentHealth("a1")!.status).toBe("active");

      // 3rd failure → degraded
      monitor.recordAgentCall("a1", false, 10, "err3");
      expect(monitor.getAgentHealth("a1")!.status).toBe("degraded");
    });

    it("marks inactive after maxTotalFailuresBeforeInactive", () => {
      const monitor = new RegistryMonitor({
        maxConsecutiveFailures: 2,
        maxTotalFailuresBeforeInactive: 4,
      });
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      // Fail 4 times
      for (let i = 0; i < 4; i++) {
        monitor.recordAgentCall("a1", false, 10, "err" + i);
      }

      expect(monitor.getAgentHealth("a1")!.status).toBe("inactive");
    });

    it("recovers from degraded on success", () => {
      const monitor = new RegistryMonitor({ maxConsecutiveFailures: 2 });
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      // Degrade
      monitor.recordAgentCall("a1", false, 10, "err1");
      monitor.recordAgentCall("a1", false, 10, "err2");
      expect(monitor.getAgentHealth("a1")!.status).toBe("degraded");

      // Recover
      monitor.recordAgentCall("a1", true, 100);
      expect(monitor.getAgentHealth("a1")!.status).toBe("active");
      expect(monitor.getAgentHealth("a1")!.consecutiveFailures).toBe(0);
    });
  });

  describe("setAgentStatus", () => {
    it("manually sets status", () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      monitor.setAgentStatus("a1", "inactive");
      expect(monitor.getAgentHealth("a1")!.status).toBe("inactive");

      monitor.setAgentStatus("a1", "active");
      expect(monitor.getAgentHealth("a1")!.status).toBe("active");
      expect(monitor.getAgentHealth("a1")!.consecutiveFailures).toBe(0);
    });
  });

  describe("getAllHealth / getHealthyAgents / getUnhealthyAgents", () => {
    it("returns all agents health", () => {
      const monitor = new RegistryMonitor();
      monitor.registerAgent(createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      })));
      monitor.registerAgent(createMockAgent("a2", async () => ({
        agentId: "a2",
        content: "ok",
        confidence: 1,
      })));

      expect(monitor.getAllHealth().length).toBe(2);
      expect(monitor.getHealthyAgents().length).toBe(2);
      expect(monitor.getUnhealthyAgents().length).toBe(0);
    });

    it("filters unhealthy agents", () => {
      const monitor = new RegistryMonitor({ maxConsecutiveFailures: 1 });
      monitor.registerAgent(createMockAgent("healthy", async () => ({
        agentId: "healthy",
        content: "ok",
        confidence: 1,
      })));
      monitor.registerAgent(createMockAgent("sick", async () => ({
        agentId: "sick",
        content: "ok",
        confidence: 1,
      })));

      monitor.recordAgentCall("sick", false, 10, "err");

      expect(monitor.getHealthyAgents().length).toBe(1);
      expect(monitor.getHealthyAgents()[0].agentId).toBe("healthy");
      expect(monitor.getUnhealthyAgents().length).toBe(1);
      expect(monitor.getUnhealthyAgents()[0].agentId).toBe("sick");
    });
  });

  describe("checkAgent", () => {
    it("returns true for healthy agent", async () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "pong",
        confidence: 1,
      }));
      monitor.registerAgent(agent);

      const result = await monitor.checkAgent("a1", agent);
      expect(result).toBe(true);
      expect(monitor.getAgentHealth("a1")!.totalChecks).toBe(1);
    });

    it("returns false for failing agent", async () => {
      const monitor = new RegistryMonitor();
      const agent = createFailingAgent("a1", "crash");
      monitor.registerAgent(agent);

      const result = await monitor.checkAgent("a1", agent);
      expect(result).toBe(false);
      expect(monitor.getAgentHealth("a1")!.consecutiveFailures).toBe(1);
    });

    it("returns false for timed out agent", async () => {
      const monitor = new RegistryMonitor({ healthCheckTimeoutMs: 50 });
      const agent = createSlowAgent("a1", 500); // 500ms > 50ms timeout
      monitor.registerAgent(agent);

      const result = await monitor.checkAgent("a1", agent);
      expect(result).toBe(false);
      expect(monitor.getAgentHealth("a1")!.lastError).toContain("timeout");
    });

    it("skips inactive agents", async () => {
      const monitor = new RegistryMonitor();
      const agent = createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      }));
      monitor.registerAgent(agent);
      monitor.setAgentStatus("a1", "inactive");

      const result = await monitor.checkAgent("a1", agent);
      expect(result).toBe(false);
      expect(monitor.getAgentHealth("a1")!.totalChecks).toBe(0);
    });
  });

  describe("runChecks", () => {
    it("checks all registered agents", async () => {
      const monitor = new RegistryMonitor();
      monitor.registerAgent(createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      })));
      monitor.registerAgent(createFailingAgent("a2", "fail"));

      await monitor.runChecks();

      expect(monitor.getAgentHealth("a1")!.totalChecks).toBe(1);
      expect(monitor.getAgentHealth("a1")!.status).toBe("active");
      expect(monitor.getAgentHealth("a2")!.totalChecks).toBe(1);
      expect(monitor.getAgentHealth("a2")!.consecutiveFailures).toBe(1);
    });
  });

  describe("exportStatus", () => {
    it("exports correct counts", () => {
      const monitor = new RegistryMonitor({ maxConsecutiveFailures: 1 });
      monitor.registerAgent(createMockAgent("h1", async () => ({
        agentId: "h1",
        content: "ok",
        confidence: 1,
      })));
      monitor.registerAgent(createMockAgent("h2", async () => ({
        agentId: "h2",
        content: "ok",
        confidence: 1,
      })));
      monitor.registerAgent(createMockAgent("d1", async () => ({
        agentId: "d1",
        content: "ok",
        confidence: 1,
      })));

      monitor.recordAgentCall("d1", false, 10, "err");

      const status = monitor.exportStatus();
      expect(status.totalAgents).toBe(3);
      expect(status.healthy).toBe(2);
      expect(status.degraded).toBe(1);
      expect(status.inactive).toBe(0);
      expect(status.agents.length).toBe(3);
    });
  });

  describe("start / stop", () => {
    it("starts and stops periodic monitoring", () => {
      vi.useFakeTimers();
      const monitor = new RegistryMonitor({ checkIntervalMs: 1000 });
      monitor.registerAgent(createMockAgent("a1", async () => ({
        agentId: "a1",
        content: "ok",
        confidence: 1,
      })));

      monitor.start();
      expect(monitor["running"]).toBe(true);

      // Advance time
      vi.advanceTimersByTime(3000);
      // Should have run ~3 checks

      monitor.stop();
      expect(monitor["running"]).toBe(false);

      vi.useRealTimers();
    });
  });
});
