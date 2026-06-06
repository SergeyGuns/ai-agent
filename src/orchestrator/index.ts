import { v4 as uuid } from "uuid";
import {
  AgentDescriptor,
  AgentRequest,
  AgentResponse,
  OrchestratorConfig,
} from "./types.js";

export class Orchestrator {
  private agents: Map<string, AgentDescriptor> = new Map();
  private config: OrchestratorConfig;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = {
      maxAgents: 10,
      defaultAgentId: "default",
      ...config,
    };
  }

  registerAgent(agent: AgentDescriptor): void {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error("Agent limit reached");
    }
    this.agents.set(agent.id, agent);
  }

  getAgent(id: string): AgentDescriptor | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentDescriptor[] {
    return [...this.agents.values()];
  }

  async handle(message: string): Promise<AgentResponse> {
    const request: AgentRequest = {
      id: uuid(),
      message,
    };
    const agent = this.agents.get(this.config.defaultAgentId);
    if (!agent) {
      return {
        agentId: "none",
        content: "No default agent registered",
        confidence: 0,
      };
    }
    return agent.handler(request);
  }
}
