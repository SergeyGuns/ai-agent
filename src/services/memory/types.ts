export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agentId?: string;
  toolName?: string;
  timestamp: number;
}

export interface SessionMetadata {
  channel?: string;        // e.g., "web", "cli", "api"
  userId?: string;         // end-user identifier
  tags?: string[];         // custom tags for filtering
  [key: string]: string | string[] | undefined;
}

export interface ConversationSession {
  id: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: SessionMetadata;
}

export interface ConversationStoreOptions {
  maxMessages?: number;       // максимум сообщений в сессии (по умолчанию 100)
  maxSessions?: number;       // максимум сессий в памяти (по умолчанию 50)
  persistPath?: string;       // путь для сохранения в JSON (опционально)
  retentionDays?: number;     // дней хранения сессий (по умолчанию 30, 0 = бесконечно)
  archivePath?: string;       // путь для архивации старых сессий (опционально)
}
