import { describe, it, expect } from "vitest";
import { CommandAgent } from "../agents/command/agent.js";

describe("CommandAgent", () => {
  it("возвращает экземпляр с методом execute", () => {
    const agent = new CommandAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.execute).toBe("function");
  });
});

describe("CommandAgent — классификация интентов", () => {
  it("keyword-classifier распознаёт command-exec intent", async () => {
    const { classifyByKeyword } = await import("../orchestrator/classifier.js");
    const result = classifyByKeyword("выполни команду npm test");
    expect(result).not.toBeNull();
    expect(result?.intent).toBe("command-exec");
  });

  it("keyword-classifier распознаёт shell intent", async () => {
    const { classifyByKeyword } = await import("../orchestrator/classifier.js");
    const result = classifyByKeyword("напиши bash скрипт для бэкапа");
    expect(result).not.toBeNull();
    expect(result?.intent).toBe("shell");
  });

  it("keyword-classifier распознаёт devops intent (docker)", async () => {
    const { classifyByKeyword } = await import("../orchestrator/classifier.js");
    const result = classifyByKeyword("docker compose up -d");
    expect(result).not.toBeNull();
    expect(result?.intent).toBe("devops");
  });

  it("keyword-classifier распознаёт devops intent (deploy)", async () => {
    const { classifyByKeyword } = await import("../orchestrator/classifier.js");
    const result = classifyByKeyword("задеплой приложение на сервер");
    expect(result).not.toBeNull();
    expect(result?.intent).toBe("devops");
  });

  it("keyword-classifier распознаёт devops intent (git)", async () => {
    const { classifyByKeyword } = await import("../orchestrator/classifier.js");
    const result = classifyByKeyword("сделай git push");
    expect(result).not.toBeNull();
    expect(result?.intent).toBe("devops");
  });

  it("resolveCapability маппит command-exec на command-exec", async () => {
    const { SemanticRouter } = await import("../orchestrator/classifier.js");
    expect(SemanticRouter.resolveCapability("command-exec")).toBe("command-exec");
    expect(SemanticRouter.resolveCapability("shell")).toBe("shell");
    expect(SemanticRouter.resolveCapability("devops")).toBe("devops");
  });
});

describe("CommandAgent — интеграция с Orchestrator", () => {
  it("оркестратор маршрутизирует command-exec к command-agent", async () => {
    const { Orchestrator } = await import("../orchestrator/index.js");
    const orch = new Orchestrator();
    orch.registerAgent({
      id: "command-agent",
      name: "Command Agent",
      type: "local",
      capabilities: ["command-exec", "shell", "devops"],
      handler: async (req) => ({
        agentId: "command-agent",
        content: `Executed: ${req.message}`,
        confidence: 0.95,
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

    const response = await orch.handle("выполни команду npm test");
    expect(response.agentId).toBe("command-agent");
    expect(response.content).toBe("Executed: выполни команду npm test");
  }, 30000);

  it("оркестратор маршрутизирует devops intent к command-agent", async () => {
    const { Orchestrator } = await import("../orchestrator/index.js");
    const orch = new Orchestrator();
    orch.registerAgent({
      id: "command-agent",
      name: "Command Agent",
      type: "local",
      capabilities: ["command-exec", "shell", "devops"],
      handler: async (req) => ({
        agentId: "command-agent",
        content: `DevOps: ${req.message}`,
        confidence: 0.95,
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

    const response = await orch.handle("запусти docker compose up -d");
    expect(response.agentId).toBe("command-agent");
  }, 30000);

  it("оркестратор маршрутизирует shell intent к command-agent", async () => {
    const { Orchestrator } = await import("../orchestrator/index.js");
    const orch = new Orchestrator();
    orch.registerAgent({
      id: "command-agent",
      name: "Command Agent",
      type: "local",
      capabilities: ["command-exec", "shell", "devops"],
      handler: async (req) => ({
        agentId: "command-agent",
        content: `Shell: ${req.message}`,
        confidence: 0.95,
      }),
    });

    const response = await orch.handle("выполни shell скрипт для бэкапа");
    expect(response.agentId).toBe("command-agent");
  }, 30000);
});

describe("CommandAgent — inferRole", () => {
  it("command-exec capability → admin role", async () => {
    const { loadRegistry } = await import("../registry/registry.js");
    const registry = loadRegistry();
    const commandAgent = registry.find((a) => a.id === "command-agent");
    expect(commandAgent).toBeDefined();
    expect(commandAgent?.role).toBe("admin");
    expect(commandAgent?.capabilities).toContain("command-exec");
    expect(commandAgent?.capabilities).toContain("shell");
    expect(commandAgent?.capabilities).toContain("devops");
  });

  it("registry загружается без ошибок с новым агентом", async () => {
    const { loadRegistry } = await import("../registry/registry.js");
    const registry = loadRegistry();
    expect(registry.length).toBe(5); // code, rag, web-research, command, general
    const ids = registry.map((a) => a.id);
    expect(ids).toContain("command-agent");
  });
});
