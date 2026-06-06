import { Agent } from "../services/ai/agent.js";
import { Orchestrator } from "../orchestrator/index.js";
import { classify } from "../orchestrator/classifier.js";
import { loadRegistry } from "../registry/registry.js";
import type { AgentDescriptor, AgentRequest, AgentResponse } from "../orchestrator/types.js";

export class SupervisorAgent {
  private orchestrator: Orchestrator;
  private registry;

  constructor(workspaceRoot?: string) {
    this.registry = loadRegistry();
    this.orchestrator = new Orchestrator({ defaultAgentId: "general-agent" });

    const agent = new Agent({
      maxIterations: 5,
      systemPrompt: "Ты — AI-ассистент. Используй инструменты для ответа.",
      workspaceRoot: workspaceRoot || process.cwd(),
    });

    for (const descriptor of this.registry) {
      const desc: AgentDescriptor = {
        ...descriptor,
        handler: async (req: AgentRequest): Promise<AgentResponse> => {
          const result = await agent.process(req.message);
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

    const agent = this.orchestrator.listAgents().find((a) =>
      a.capabilities.includes(intent),
    );

    const agentId = agent?.id ?? "general-agent";
    console.log("[Supervisor] selected agent: " + agentId);

    const response = await this.orchestrator.handle(message);
    return response.content;
  }
}
