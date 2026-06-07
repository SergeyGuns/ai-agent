

/**
 * Адаптер: оборачивает SupervisorAgent для TUI.
 * Предоставляет методы, которые TUI ожидает.
 */
export interface TUISupervisorAdapter {
  handle: (message: string, sessionId: string) => Promise<string>;
  getConversationHistory: (sessionId: string) => Array<{ role: string; content: string; timestamp?: number; agentId?: string }>;
  listSessions: () => Array<{ id: string; messages: Array<unknown>; updatedAt: number }>;
  clearSession: (sessionId: string) => void;
  getMetrics: () => string;
  getLogs: () => string;
  getAuditLog: () => string;
  listAgents: () => Array<{ id: string; name: string; type: string; capabilities: string[]; version?: string; status?: string }>;
}

export function createTUIAdapter(supervisor: import("../agents/supervisor.js").SupervisorAgent): TUISupervisorAdapter {
  // List agents from supervisor's orchestrator
  const orchestrator = (supervisor as unknown as { orchestrator: { listAgents: () => Array<{ id: string; name: string; type: string; capabilities: string[]; version?: string; status?: string }> } }).orchestrator;
  const agents = orchestrator?.listAgents() ?? [];

  return {
    async handle(message: string, sessionId: string) {
      return supervisor.handle(message, sessionId);
    },
    getConversationHistory(sessionId: string) {
      return supervisor.getConversationHistory(sessionId);
    },
    listSessions() {
      return supervisor.listSessions();
    },
    clearSession(sessionId: string) {
      supervisor.clearSession(sessionId);
    },
    getMetrics() {
      return supervisor.getMetrics();
    },
    getLogs() {
      return supervisor.getLogs();
    },
    getAuditLog() {
      return supervisor.getAuditLog();
    },
    listAgents() {
      return agents;
    },
  };
}
