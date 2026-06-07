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

  it("returns error when no agent available", async () => {
    const orch = new Orchestrator();
    const response = await orch.handle("hello");
    expect(response.content).toContain("No agent available");
    expect(response.confidence).toBe(0);
  });

  describe("capability-based routing", () => {
    it("routes web-search intent to web-search agent", async () => {
      const orch = new Orchestrator();
      orch.registerAgent({
        id: "web-agent",
        name: "Web Agent",
        type: "local",
        capabilities: ["web-search"],
        handler: async (req) => ({
          agentId: "web-agent",
          content: "Web search result",
          confidence: 0.9,
        }),
      });
      orch.registerAgent({
        id: "general-agent",
        name: "General Agent",
        type: "local",
        capabilities: ["general"],
        handler: async (req) => ({
          agentId: "general-agent",
          content: "General response",
          confidence: 0.5,
        }),
      });

      const response = await orch.handle("поиск информации о TypeScript");
      expect(response.agentId).toBe("web-agent");
      expect(response.content).toBe("Web search result");
    });

    it("routes code-search intent to code-search agent", async () => {
      const orch = new Orchestrator();
      orch.registerAgent({
        id: "code-agent",
        name: "Code Agent",
        type: "local",
        capabilities: ["code-search"],
        handler: async (req) => ({
          agentId: "code-agent",
          content: "Code search result",
          confidence: 0.9,
        }),
      });

      const response = await orch.handle("найди функцию handleRequest в коде");
      expect(response.agentId).toBe("code-agent");
    });

    it("routes file-list intent to file-list agent", async () => {
      const orch = new Orchestrator();
      orch.registerAgent({
        id: "file-agent",
        name: "File Agent",
        type: "local",
        capabilities: ["file-list"],
        handler: async (req) => ({
          agentId: "file-agent",
          content: "File list result",
          confidence: 0.9,
        }),
      });

      const response = await orch.handle("покажи список файлов");
      expect(response.agentId).toBe("file-agent");
    });

    it("falls back to general agent when no specific agent found", async () => {
      const orch = new Orchestrator();
      orch.registerAgent({
        id: "general-agent",
        name: "General Agent",
        type: "local",
        capabilities: ["general"],
        handler: async (req) => ({
          agentId: "general-agent",
          content: "General fallback",
          confidence: 0.5,
        }),
      });

      const response = await orch.handle("поиск информации о TypeScript");
      expect(response.agentId).toBe("general-agent");
    });

    it("does not route to inactive agents", async () => {
      const orch = new Orchestrator();
      orch.registerAgent({
        id: "inactive-web",
        name: "Inactive Web",
        type: "local",
        capabilities: ["web-search"],
        status: "inactive",
        handler: async (req) => ({
          agentId: "inactive-web",
          content: "Should not reach",
          confidence: 0.9,
        }),
      });
      orch.registerAgent({
        id: "general-agent",
        name: "General Agent",
        type: "local",
        capabilities: ["general"],
        handler: async (req) => ({
          agentId: "general-agent",
          content: "General fallback",
          confidence: 0.5,
        }),
      });

      const response = await orch.handle("поиск информации о TypeScript");
      expect(response.agentId).toBe("general-agent");
    });

    it("lists all registered agents", () => {
      const orch = new Orchestrator();
      orch.registerAgent({
        id: "agent-1",
        name: "Agent 1",
        type: "local",
        capabilities: ["test"],
        handler: async () => ({ agentId: "agent-1", content: "", confidence: 0 }),
      });
      orch.registerAgent({
        id: "agent-2",
        name: "Agent 2",
        type: "local",
        capabilities: ["test"],
        handler: async () => ({ agentId: "agent-2", content: "", confidence: 0 }),
      });

      const agents = orch.listAgents();
      expect(agents.length).toBe(2);
    });
  });
});
