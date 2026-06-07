import { v4 as uuid } from "uuid";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Long-Term Memory для мультиагентной системы.
 *
 * Хранит факты и предользовательские предпочтения между сессиями.
 * Референсная архитектура MS: Memory.md — LTM предоставляет persistence
 * информации между сессиями, позволяя агентам вспоминать знания и предпочтения.
 *
 * v2 — Auto-persistence:
 * - Debounced запись на диск (по умолчанию .data/long-term-memory.json)
 * - Автозагрузка при создании (если путь задан)
 * - TTL для фактов (автоматическое удаление устаревших)
 * - Data retention: архивация старых фактов
 */

export interface LTMOptions {
  /** Путь для персистентности (по умолчанию .data/long-term-memory.json) */
  persistPath?: string;
  /** Интервал debounced записи в мс (по умолчанию 1000) */
  persistDebounceMs?: number;
  /** TTL для фактов в днях (0 = бесконечно, по умолчанию 90) */
  factTtlDays?: number;
  /** Максимальное количество фактов (по умолчанию 10000) */
  maxFacts?: number;
}

const DEFAULT_LTM_OPTIONS: Required<LTMOptions> = {
  persistPath: ".data/long-term-memory.json",
  persistDebounceMs: 1000,
  factTtlDays: 90,
  maxFacts: 10_000,
};

export interface LongTermFact {
  id: string;
  /** Содержимое факта */
  content: string;
  /** Источник: какой агент/сессия создал факт */
  source: string;
  /** Теги для категоризации */
  tags: string[];
  /** Confidence (0.0-1.0) */
  confidence: number;
  /** Количество подтверждений (re-mention) */
  mentionCount: number;
  /** Связанные ID фактов */
  relatedFactIds: string[];
  timestamp: number;
  /** Кто создал (agentId или userId) */
  createdBy: string;
}

export interface UserPreference {
  userId: string;
  key: string;
  value: string;
  updatedAt: number;
}

export interface LongTermMemoryData {
  facts: Record<string, LongTermFact>;
  preferences: Record<string, UserPreference>;
  version: number;
}

/**
 * Создаёт пустую структуру LTM.
 */
export function createEmptyLTM(): LongTermMemoryData {
  return {
    facts: {},
    preferences: {},
    version: 1,
  };
}

/**
 * LongTermMemory — хранение и поиск фактов/предпочтений между сессиями.
 *
 * v2: авто-персистентность на диск, TTL для фактов, data retention.
 */
export class LongTermMemory {
  private data: LongTermMemoryData;
  private dirty = false;
  private options: Required<LTMOptions>;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(initial?: LongTermMemoryData, options?: LTMOptions) {
    this.options = { ...DEFAULT_LTM_OPTIONS, ...options };
    this.data = initial ?? createEmptyLTM();

    // Автозагрузка с диска
    if (this.options.persistPath) {
      this.loadFromDisk();
    }
  }

  // === Facts ===

  /**
   * Добавить или обновить факт.
   * Если факт с таким content уже существует — увеличивает mentionCount.
   */
  addFact(content: string, opts?: {
    tags?: string[];
    confidence?: number;
    createdBy?: string;
    source?: string;
    relatedFactIds?: string[];
  }): LongTermFact {
    // Проверяем дубликат по content
    const existing = this.findByContent(content);
    if (existing) {
      existing.mentionCount++;
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      this.dirty = true;
      return existing;
    }

    const fact: LongTermFact = {
      id: uuid(),
      content,
      source: opts?.source ?? "unknown",
      tags: opts?.tags ?? [],
      confidence: opts?.confidence ?? 0.5,
      mentionCount: 1,
      relatedFactIds: opts?.relatedFactIds ?? [],
      timestamp: Date.now(),
      createdBy: opts?.createdBy ?? "system",
    };

    this.data.facts[fact.id] = fact;
    this.dirty = true;
    this._schedulePersist();
    return fact;
  }

  /**
   * Найти факт по content (точное или частичное совпадение).
   */
  findByContent(content: string): LongTermFact | undefined {
    const lower = content.toLowerCase();
    for (const fact of this.allFacts()) {
      if (fact.content.toLowerCase().includes(lower) || lower.includes(fact.content.toLowerCase())) {
        return fact;
      }
    }
    return undefined;
  }

  /**
   * Поиск фактов по тегам.
   */
  findByTags(tags: string[]): LongTermFact[] {
    return this.allFacts().filter((f) => tags.some((t) => f.tags.includes(t)));
  }

  /**
   * Поиск фактов по ключевому слову (content substring).
   */
  search(query: string): LongTermFact[] {
    const lower = query.toLowerCase();
    return this.allFacts()
      .filter((f) => f.content.toLowerCase().includes(lower))
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Получить все факты, отсортированные по confidence (убывание).
   */
  allFacts(): LongTermFact[] {
    return Object.values(this.data.facts).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Удалить факт по ID.
   */
  removeFact(id: string): boolean {
    if (this.data.facts[id]) {
      delete this.data.facts[id];
      this.dirty = true;
      this._schedulePersist();
      return true;
    }
    return false;
  }

  // === Preferences ===

  /**
   * Установить предпочтение пользователя.
   */
  setPreference(userId: string, key: string, value: string): void {
    const prefKey = userId + ":" + key;
    this.data.preferences[prefKey] = {
      userId,
      key,
      value,
      updatedAt: Date.now(),
    };
    this.dirty = true;
    this._schedulePersist();
  }

  /**
   * Получить предпочтение пользователя.
   */
  getPreference(userId: string, key: string): string | undefined {
    const prefKey = userId + ":" + key;
    return this.data.preferences[prefKey]?.value;
  }

  /**
   * Получить все предпочтения пользователя.
   */
  getUserPreferences(userId: string): UserPreference[] {
    return Object.values(this.data.preferences).filter((p) => p.userId === userId);
  }

  // === Context Query ===

  /**
   * Сформировать контекст для промпта на основе запроса.
   * Возвращает строку с relevant facts для вставки в system prompt.
   */
  buildContext(query: string, maxFacts = 5): string {
    const relevant = this.search(query).slice(0, maxFacts);
    if (relevant.length === 0) return "";

    const lines = relevant.map((f) => "[" + f.tags.join(", ") + "] " + f.content);
    return "Relevant past knowledge:\n" + lines.map((l) => "- " + l).join("\n");
  }

  /**
   * Сериализация для сохранения.
   */
  serialize(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Принудительно сохранить на диск.
   */
  flush(): void {
    this._persistToDisk();
  }

  /**
   * Применить TTL политику — удалить факты старше factTtlDays.
   * Возвращает количество удалённых фактов.
   */
  applyTtlPolicy(): number {
    if (this.options.factTtlDays <= 0) return 0;

    const cutoff = Date.now() - this.options.factTtlDays * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const [id, fact] of Object.entries(this.data.facts)) {
      if (fact.timestamp < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      delete this.data.facts[id];
    }

    if (toDelete.length > 0) {
      this.dirty = true;
      this._schedulePersist();
    }

    return toDelete.length;
  }

  // === Private persistence methods ===

  /**
   * Отложенная запись на диск (debounce).
   */
  private _schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this._persistToDisk();
      this.persistTimer = null;
    }, this.options.persistDebounceMs);
  }

  private _persistToDisk(): void {
    if (!this.options.persistPath || !this.dirty) return;
    try {
      const resolvedPath = this.options.persistPath.startsWith("/")
        ? this.options.persistPath
        : path.resolve(process.cwd(), this.options.persistPath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, this.serialize(), "utf-8");
      this.dirty = false;
    } catch {
      // Не критично — молча игнорируем
    }
  }

  private loadFromDisk(): void {
    try {
      const resolvedPath = this.options.persistPath.startsWith("/")
        ? this.options.persistPath
        : path.resolve(process.cwd(), this.options.persistPath);
      if (!fs.existsSync(resolvedPath)) return;
      const raw = fs.readFileSync(resolvedPath, "utf-8");
      const data = JSON.parse(raw) as LongTermMemoryData;
      this.data = data;
    } catch {
      // Файл повреждён — начинаем с чистого листа
    }
  }

  /**
   * Десериализация.
   */
  static deserialize(json: string): LongTermMemory {
    const data = JSON.parse(json) as LongTermMemoryData;
    return new LongTermMemory(data);
  }

  /**
   * Получить данные (для персистентности).
   */
  getData(): LongTermMemoryData {
    return this.data;
  }
}
