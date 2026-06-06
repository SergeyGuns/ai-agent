import { describe, it, expect } from "vitest";
import { Orchestrator } from "../orchestrator/index.js";

describe("Orchestrator", () => {
  it("registers and retrieves agents", () => {
    const orch = new Orchestrator();
    orch.registerAgent({
      id: "test-agent",
      name: "Test",
      type: "local",
      capabilities: ["test"],
      handler: async (req) => ({
        agentId: "test-agent",
        content: `Echo: ${req.message}`,
        confidence: 1,
      }),
    });

    const agent = orch.getAgent("test-agent");
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("Test");
  });

  it("handles request with default agent", async () => {
    const orch = new Orchestrator({ defaultAgentId: "echo" });
    orch.registerAgent({
      id: "echo",
      name: "Echo",
      type: "local",
      capabilities: ["general"],
      handler: async (req) => ({
        agentId: "echo",
        content: req.message,
        confidence: 1,
      }),
    });

    const response = await orch.handle("hello");
    expect(response.content).toBe("hello");
    expect(response.agentId).toBe("echo");
  });

  it("returns error when no default agent", async () => {
    const orch = new Orchestrator();
    const response = await orch.handle("hello");
    expect(response.content).toBe("No default agent registered");
    expect(response.confidence).toBe(0);
  });
});
