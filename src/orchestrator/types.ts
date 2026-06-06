export interface AgentDescriptor {
  id: string;
  name: string;
  type: "local" | "remote";
  capabilities: string[];
  handler: (request: AgentRequest) => Promise<AgentResponse>;
  version?: string;
  status?: "active" | "inactive" | "degraded";
}

export interface AgentRequest {
  id: string;
  message: string;
  context?: Record<string, unknown>;
  sessionId?: string;
}

export interface AgentResponse {
  agentId: string;
  content: string;
  confidence: number;
}

export interface OrchestratorConfig {
  maxAgents: number;
  defaultAgentId: string;
}
