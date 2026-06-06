import * as fs from "node:fs";
import * as path from "node:path";
import { ConversationMessage, ConversationSession, ConversationStoreOptions } from "./types.js";

/**
 * ConversationStore — Short-Term Memory для мультиагентной системы.
 * Хранит историю сообщений по session_id.
 * Поддерживает персистентность в JSON-файл.
 *
 * Реализует паттерн Shared Memory из MS Reference Architecture:
 * все агенты пишут в единое хранилище, идентифицируемое по session_id.
 */
export class ConversationStore {
  private sessions: Map<string, ConversationSession> = new Map();
  private options: Required<ConversationStoreOptions>;

  constructor(options?: ConversationStoreOptions) {
    this.options = {
      maxMessages: options?.maxMessages ?? 100,
      maxSessions: options?.maxSessions ?? 50,
      persistPath: options?.persistPath ?? "",
    };

    if (this.options.persistPath) {
      this.loadFromDisk();
    }
  }

  /**
   * Получить или создать сессию
   */
  getOrCreate(sessionId: string): ConversationSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      // Если сессий слишком много — удаляем самую старую
      if (this.sessions.size >= this.options.maxSessions) {
        this.evictOldest();
      }
      session = {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Добавить сообщение в сессию
   */
  addMessage(
    sessionId: string,
    role: ConversationMessage["role"],
    content: string,
    meta?: { agentId?: string; toolName?: string }
  ): void {
    const session = this.getOrCreate(sessionId);
    session.messages.push({
      role,
      content,
      agentId: meta?.agentId,
      toolName: meta?.toolName,
      timestamp: Date.now(),
    });
    session.updatedAt = Date.now();

    // Обрезаем старые сообщения если превышен лимит
    if (session.messages.length > this.options.maxMessages) {
      session.messages = session.messages.slice(-this.options.maxMessages);
    }

    this.maybePersist();
  }

  /**
   * Получить историю сообщений сессии
   */
  getMessages(sessionId: string): ConversationMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  /**
   * Получить последние N сообщений
   */
  getRecentMessages(sessionId: string, count: number): ConversationMessage[] {
    const messages = this.getMessages(sessionId);
    return messages.slice(-count);
  }

  /**
   * Очистить сессию
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.maybePersist();
  }

  /**
   * Получить все активные сессии
   */
  listSessions(): ConversationSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Получить количество сессий
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Экспорт всех сессий в JSON
   */
  exportAll(): string {
    return JSON.stringify(
      Object.fromEntries(
        [...this.sessions.entries()].map(([id, s]) => [id, s])
      ),
      null,
      2
    );
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, session] of this.sessions) {
      if (session.updatedAt < oldestTime) {
        oldestTime = session.updatedAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.sessions.delete(oldestId);
    }
  }

  private maybePersist(): void {
    if (!this.options.persistPath) return;
    try {
      const dir = path.dirname(this.options.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.options.persistPath, this.exportAll(), "utf-8");
    } catch (e) {
      // Не критично — молча игнорируем
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.options.persistPath)) return;
      const raw = fs.readFileSync(this.options.persistPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, ConversationSession>;
      for (const [id, session] of Object.entries(data)) {
        this.sessions.set(id, session);
      }
    } catch {
      // Файл повреждён — начинаем с чистого листа
    }
  }
}
