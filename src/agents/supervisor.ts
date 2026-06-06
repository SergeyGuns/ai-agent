import { Agent } from "../services/ai/agent.js";
import { Orchestrator } from "../orchestrator/index.js";
import { classify } from "../orchestrator/classifier.js";
import { loadRegistry } from "../registry/registry.js";
import { WebResearchAgent } from "./web-research/agent.js";
import type { AgentDescriptor, AgentRequest, AgentResponse } from "../orchestrator/types.js";

export class SupervisorAgent {
  private orchestrator: Orchestrator;
  private registry;
  private codeAgent: Agent;
  private webAgent: WebResearchAgent;

  constructor(workspaceRoot?: string) {
    this.registry = loadRegistry();
    this.orchestrator = new Orchestrator({ defaultAgentId: "general-agent" });

    // Создаём агентов
    this.codeAgent = new Agent({
      maxIterations: 999,
      systemPrompt: "Ты — AI-ассистент для работы с кодом. Используй инструменты.",
      workspaceRoot: workspaceRoot || process.cwd(),
    });

    this.webAgent = new WebResearchAgent();

    // Регистрируем всех агентов из реестра
    for (const descriptor of this.registry) {
      const desc: AgentDescriptor = {
        ...descriptor,
        handler: async (req: AgentRequest): Promise<AgentResponse> => {
          let result: string;

          // Маршрутизация к нужному агенту
          if (descriptor.id === "web-research-agent") {
            const researchResult = await this.webAgent.research(req.message);
            result = researchResult.summary;
          } else {
            // Все остальные агенты используют стандартный Agent
            result = await this.codeAgent.process(req.message);
          }

          return {
            agentId: descriptor.id,
            content: result,
            confidence: 1,
          };
        },
      };
      this.orchestrator.registerAgent(desc);
    }
  }

  async handle(message: string): Promise<string> {
    const { intent, confidence } = classify(message);
    console.log("[Supervisor] intent=" + intent + ", confidence=" + confidence);

    // Находим подходящего агента
    const agent = this.orchestrator.listAgents().find((a) =>
      a.capabilities.includes(intent),
    );

    const agentId = agent?.id ?? "general-agent";
    console.log("[Supervisor] selected agent: " + agentId);

    const response = await this.orchestrator.handle(message);
    return response.content;
  }
}
