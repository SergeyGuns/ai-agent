import { AIService } from "../services/ai/service.js";

export interface ClassificationResult {
  intent: string;
  confidence: number;
  method: "keyword" | "llm" | "fallback";
}

// Маппинг intent → capability для маршрутизации
export const INTENT_TO_CAPABILITY: Record<string, string> = {
  "web-search": "web-search",
  "web-scrape": "web-scrape",
  "browser": "browser",
  "fact-check": "fact-check",
  "file-list": "file-list",
  "file-read": "file-read",
  "code-search": "code-search",
  "rag-query": "retrieval",
  "command-exec": "command-exec",
  "shell": "shell",
  "devops": "devops",
  "general": "general",
};

const INTENT_PATTERNS: { intent: string; keywords: string[]; weight: number }[] = [
  {
    intent: "web-search",
    weight: 1.0,
    keywords: [
      "поиск", "google", "duckduckgo",
      "в интернете", "онлайн", "online", "web", "сайт",
      "что такое", "кто такой", "расскажи о", "информация о",
      "новости", "news", "актуальный", "последний",
    ],
  },
  {
    intent: "web-scrape",
    weight: 1.2, // Более специфичный intent — повышаем вес
    keywords: [
      "загрузи страницу", "fetch", "парсинг", "scrape",
      "содержимое сайта", "текст страницы", "url",
    ],
  },
  {
    intent: "browser",
    weight: 1.2,
    keywords: [
      "браузер", "browser", "открой сайт", "навигация",
      "кликни", "введи текст", "скриншот", "js", "javascript",
    ],
  },
  {
    intent: "fact-check",
    weight: 1.3, // Самый специфичный — высокий вес
    keywords: [
      "проверь факт", "fact check", "верификация", "правда ли",
      "подтверди", "источники", "достоверность",
    ],
  },
  {
    intent: "file-list",
    weight: 1.0,
    keywords: [
      "список файлов", "list files", "show files",
      "список", "list", "файлы", "files", "директор", "folder",
      "папка", "покажи файлы", "какие файлы", "ls", "dir",
    ],
  },
  {
    intent: "file-read",
    weight: 1.0,
    keywords: [
      "файл", "file", "прочитать", "read", "содержим",
      "show", "открой файл", "cat", "head",
      "прочитай", "read file",
    ],
  },
  {
    intent: "code-search",
    weight: 1.1,
    keywords: [
      "код", "code", "function", "реализац",
      "как работает", "grep", "функция", "класс",
      "метод", "переменная", "interface", "type",
      "найди функц", "найди класс", "найди метод",
      "поиск по коду", "code search", "source code",
    ],
  },
  {
    intent: "rag-query",
    weight: 1.1,
    keywords: [
      "документ", "документац", "context", "знания", "knowledge",
      "база знаний", "wiki", "справка",
      "найди в документ", "найти в документац",
      "поиск по документ", "search documents",
      "найди в базе знаний", "найти в базе знаний",
      "базе знаний", "knowledge base",
    ],
  },
  {
    intent: "command-exec",
    weight: 1.5,
    keywords: [
      "выполни", "выполни команду", "запусти", "запустить",
      "команду", "command", "выполни команду", "exec",
      "terminal", "терминал", "shell", "bash",
    ],
  },
  {
    intent: "shell",
    weight: 1.5,
    keywords: [
      "shell", "bash", "zsh",
      "скрипт", "pipeline",
      "pipe ", "grep ", "awk ", "sed ",
      "chmod ", "chown ", "mkdir ", "rm -",
      "ls -la", "curl ", "wget ",
    ],
  },
  {
    intent: "devops",
    weight: 1.6,
    keywords: [
      "docker", "kubernetes", "k8s", "helm",
      "ci", "cd", "ci/cd", "pipeline",
      "deploy", "деплой", "build", "сборка",
      "test", "тест", "npm test", "pytest", "vitest",
      "git push", "git pull", "git commit", "git merge",
      "terraform", "ansible", "jenkins", "github actions",
      "monitoring", "лог", "логи", "logs",
      "сервер", "server", "nginx", "apache",
      "database", "бд", "db", "postgres", "mysql", "redis",
    ],
  },
  {
    intent: "general",
    weight: 0, // Fallback — не участвует в keyword matching
    keywords: [],
  },
];

// Keyword-based classification (быстрый, бесплатный)
// Использует scoring: считаем количество совпадений для каждого intent
export function classifyByKeyword(message: string): ClassificationResult | null {
  const lower = message.toLowerCase();
  let bestIntent: string | null = null;
  let bestScore = 0;
  let bestRawScore = 0;

  for (const pattern of INTENT_PATTERNS) {
    if (pattern.keywords.length === 0) continue;
    let score = 0;
    let rawScore = 0;
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) {
        // Длинные ключевые слова дают больше очков
        const kwScore = kw.length * pattern.weight;
        score += kwScore;
        rawScore += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRawScore = rawScore;
      bestIntent = pattern.intent;
    }
  }

  if (bestIntent && bestRawScore > 0) {
    // Нормализуем confidence: больше совпадений = выше confidence
    const confidence = Math.min(0.5 + bestRawScore * 0.05, 0.95);
    return { intent: bestIntent, confidence, method: "keyword" };
  }

  return null;
}

// LLM-based classification (медленный, точный)
const LLM_CLASSIFICATION_PROMPT = `Классифицируй запрос пользователя. Выбери ОДИН intent из списка:
- web-search: поиск информации в интернете
- web-scrape: загрузка/парсинг конкретной веб-страницы
- browser: работа с headless браузером (клики, навигация, скриншоты)
- fact-check: проверка фактов, верификация информации
- file-list: список файлов в директории
- file-read: чтение содержимого файла
- code-search: поиск по коду, поиск функций/классов
- rag-query: запрос к базе знаний / документации
- command-exec: выполнить команду, запустить команду, выполнить shell команду
- shell: shell/bash команды, скрипты, пайплайны, файловые операции
- devops: docker, kubernetes, deploy, build, test, git, CI/CD, серверы, базы данных
- general: общий запрос, не попадающий в другие категории

Ответь СТРОГО в формате JSON: {"intent": "<intent>", "confidence": <0.0-1.0>}`;

async function classifyByLLM(ai: AIService, message: string): Promise<ClassificationResult> {
  try {
    const response = await ai.complete(LLM_CLASSIFICATION_PROMPT, message, {
      temperature: 0.1,
      maxTokens: 100,
    });

    // Извлекаем JSON из ответа
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = parsed.intent || "general";
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

      // Валидация intent
      if (INTENT_TO_CAPABILITY[intent]) {
        return { intent, confidence, method: "llm" };
      }
    }
  } catch {
    // LLM не смог классифицировать — используем fallback
  }

  return { intent: "general", confidence: 0.3, method: "fallback" };
}

/**
 * Semantic Router с LLM Fallback.
 *
 * Стратегия (по MS Reference Architecture Pattern #1):
 * 1. Сначала пробуем keyword classification (быстро, бесплатно)
 * 2. Если keyword confidence < threshold → LLM fallback (точно, дорого)
 * 3. Если LLM не смог → fallback на general
 *
 * v2 — Confidence Threshold:
 * - KEYWORD_CONFIDENCE_THRESHOLD (0.7): если keyword уверенность ниже — зовём LLM
 * - LLM_CONFIDENCE_THRESHOLD (0.5): если LLM тоже не уверен — спрашиваем уточнение
 */
export interface SemanticRouterOptions {
  ai?: AIService;
  llmFallback?: boolean;
  keywordConfidenceThreshold?: number;
  llmConfidenceThreshold?: number;
}

export class SemanticRouter {
  private ai: AIService | null = null;
  private llmFallbackEnabled: boolean;
  private keywordThreshold: number;
  private llmThreshold: number;

  // Сбор статистики для evaluation
  private classificationLog: ClassificationResult[] = [];

  constructor(options?: SemanticRouterOptions) {
    this.ai = options?.ai ?? null;
    this.llmFallbackEnabled = options?.llmFallback ?? true;
    this.keywordThreshold = options?.keywordConfidenceThreshold ?? 0.7;
    this.llmThreshold = options?.llmConfidenceThreshold ?? 0.5;
  }

  async classify(message: string): Promise<ClassificationResult> {
    // Шаг 1: Keyword classification
    const keywordResult = classifyByKeyword(message);
    if (keywordResult && keywordResult.confidence >= this.keywordThreshold) {
      this.classificationLog.push(keywordResult);
      return keywordResult;
    }

    // Шаг 2: LLM Fallback (если keyword не уверен или не нашёл)
    if (this.llmFallbackEnabled && this.ai) {
      const llmResult = await classifyByLLM(this.ai, message);

      // Если LLM тоже не уверен — используем general с низким confidence
      if (llmResult.confidence < this.llmThreshold) {
        const uncertainResult: ClassificationResult = {
          intent: "general",
          confidence: llmResult.confidence,
          method: "fallback",
        };
        this.classificationLog.push(uncertainResult);
        return uncertainResult;
      }

      this.classificationLog.push(llmResult);
      return llmResult;
    }

    // Шаг 3: Fallback
    const fallbackResult: ClassificationResult = {
      intent: "general",
      confidence: keywordResult?.confidence ?? 0.3,
      method: "fallback",
    };
    this.classificationLog.push(fallbackResult);
    return fallbackResult;
  }

  /**
   * Получить capability для intent (для маршрутизации к агенту)
   */
  static resolveCapability(intent: string): string {
    return INTENT_TO_CAPABILITY[intent] ?? "general";
  }

  /**
   * Получить лог классификаций (для анализа и evaluation)
   */
  getClassificationLog(): ClassificationResult[] {
    return [...this.classificationLog];
  }

  /**
   * Очистить лог классификаций
   */
  clearLog(): void {
    this.classificationLog = [];
  }

  /**
   * Получить текущие пороги confidence
   */
  getThresholds(): { keyword: number; llm: number } {
    return { keyword: this.keywordThreshold, llm: this.llmThreshold };
  }

  /**
   * Установить пороги confidence
   */
  setThresholds(keyword: number, llm: number): void {
    this.keywordThreshold = Math.min(1, Math.max(0, keyword));
    this.llmThreshold = Math.min(1, Math.max(0, llm));
  }
}

// Обратная совместимость — экспорт старой функции
export async function classify(message: string, ai?: AIService): Promise<ClassificationResult> {
  const router = new SemanticRouter({ ai, llmFallback: !!ai });
  return router.classify(message);
}
