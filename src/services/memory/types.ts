export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agentId?: string;
  toolName?: string;
  timestamp: number;
}

export interface ConversationSession {
  id: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

export interface ConversationStoreOptions {
  maxMessages?: number;       // максимум сообщений в сессии (по умолчанию 100)
  maxSessions?: number;       // максимум сессий в памяти (по умолчанию 50)
  persistPath?: string;       // путь для сохранения в JSON (опционально)
}
