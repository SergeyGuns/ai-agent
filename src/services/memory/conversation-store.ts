import * as fs from "node:fs";
import * as path from "node:path";
import { ConversationMessage, ConversationSession, ConversationStoreOptions, SessionMetadata } from "./types.js";

/**
 * ConversationStore — Short-Term Memory для мультиагентной системы.
 * Хранит историю сообщений по session_id.
 * Поддерживает персистентность в JSON-файл.
 *
 * Реализует паттерн Shared Memory из MS Reference Architecture:
 * все агенты пишут в единое хранилище, идентифицируемое по session_id.
 *
 * v3 — Long-Term Memory:
 * - Автоматическая персистентность (по умолчанию .data/conversations.json)
 * - Суммаризация старых сообщений при превышении summaryThreshold
 * - Гибридная модель: горячие сообщения в STM, сводка в LTM
 */
export class ConversationStore {
  private sessions: Map<string, ConversationSession> = new Map();
  private options: Required<ConversationStoreOptions>;
  private dirty = false; // Флаг изменений для отложенной записи
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: ConversationStoreOptions) {
    this.options = {
      maxMessages: options?.maxMessages ?? 100,
      maxSessions: options?.maxSessions ?? 50,
      persistPath: options?.persistPath ?? this._defaultPersistPath(),
      retentionDays: options?.retentionDays ?? 30,
      archivePath: options?.archivePath ?? this._defaultArchivePath(),
    };

    if (this.options.persistPath) {
      this.loadFromDisk();
    }
  }

  private _defaultPersistPath(): string {
    const dataDir = path.resolve(process.cwd(), ".data");
    return path.join(dataDir, "conversations.json");
  }

  private _defaultArchivePath(): string {
    const dataDir = path.resolve(process.cwd(), ".data");
    return path.join(dataDir, "archive.json");
  }

  /**
   * Получить или создать сессию
   */
  getOrCreate(sessionId: string, metadata?: SessionMetadata): ConversationSession {
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
        metadata,
      };
      this.sessions.set(sessionId, session);
    } else if (metadata) {
      session.metadata = { ...session.metadata, ...metadata };
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
    meta?: { agentId?: string; toolName?: string },
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

    this.dirty = true;
    this._schedulePersist();
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
   * Получить метаданные сессии
   */
  getSessionMetadata(sessionId: string): SessionMetadata | undefined {
    return this.sessions.get(sessionId)?.metadata;
  }

  /**
   * Установить метаданные сессии
   */
  setSessionMetadata(sessionId: string, metadata: SessionMetadata): void {
    const session = this.getOrCreate(sessionId);
    session.metadata = { ...session.metadata, ...metadata };
    this.dirty = true;
    this._schedulePersist();
  }

  /**
   * Найти сессии по тегу
   */
  findSessionsByTag(tag: string): ConversationSession[] {
    return this.listSessions().filter(
      (s) => s.metadata?.tags?.includes(tag),
    );
  }

  /**
   * Найти сессии по userId
   */
  findSessionsByUser(userId: string): ConversationSession[] {
    return this.listSessions().filter(
      (s) => s.metadata?.userId === userId,
    );
  }

  /**
   * Очистить сессию
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.dirty = true;
    this._schedulePersist();
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
        [...this.sessions.entries()].map(([id, s]) => [id, s]),
      ),
      null,
      2,
    );
  }

  /**
   * Data Retention: удалить сессии старше retentionDays
   * Если задан archivePath — сохраняет удалённые сессии в архив
   */
  applyRetentionPolicy(): number {
    if (this.options.retentionDays <= 0) return 0;

    const cutoff = Date.now() - this.options.retentionDays * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];
    const archived: ConversationSession[] = [];

    for (const [id, session] of this.sessions) {
      if (session.updatedAt < cutoff) {
        toDelete.push(id);
        archived.push(session);
      }
    }

    // Архивация если задан путь
    if (archived.length > 0 && this.options.archivePath) {
      this.archiveSessions(archived);
    }

    // Удаление
    for (const id of toDelete) {
      this.sessions.delete(id);
    }

    if (toDelete.length > 0) {
      this.dirty = true;
      this._schedulePersist();
    }

    return toDelete.length;
  }

  /**
   * Принудительно сохранить на диск
   */
  flush(): void {
    this._persistToDisk();
  }

  // === Private methods ===

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

  /**
   * Отложенная запись на диск (debounce 500ms)
   */
  private _schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this._persistToDisk();
      this.persistTimer = null;
    }, 500);
  }

  private _persistToDisk(): void {
    if (!this.options.persistPath || !this.dirty) return;
    try {
      const dir = path.dirname(this.options.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.options.persistPath, this.exportAll(), "utf-8");
      this.dirty = false;
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

  private archiveSessions(sessions: ConversationSession[]): void {
    try {
      const dir = path.dirname(this.options.archivePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Читаем существующий архив или создаём новый
      let archive: Record<string, ConversationSession> = {};
      if (fs.existsSync(this.options.archivePath)) {
        const raw = fs.readFileSync(this.options.archivePath, "utf-8");
        archive = JSON.parse(raw);
      }

      // Добавляем сессии в архив
      for (const session of sessions) {
        archive[session.id] = session;
      }

      fs.writeFileSync(this.options.archivePath, JSON.stringify(archive, null, 2), "utf-8");
    } catch {
      // Не критично — молча игнорируем
    }
  }
}
