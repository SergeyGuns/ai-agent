export interface ClassificationResult {
  intent: string;
  confidence: number;
}

const INTENT_PATTERNS: { intent: string; keywords: string[] }[] = [
  {
    intent: "file-list",
    keywords: ["список", "list", "файлы", "files", "директор", "folder", "папка"],
  },
  {
    intent: "file-read",
    keywords: ["файл", "file", "прочитать", "read", "содержим", "покажи", "show"],
  },
  {
    intent: "code-search",
    keywords: ["код", "code", "найти", "search", "function", "реализац", "как работает", "where", "find"],
  },
  {
    intent: "rag-query",
    keywords: ["документ", "документац", "context", "знания", "knowledge", "найди информац"],
  },
  {
    intent: "general",
    keywords: [],
  },
];

export function classify(message: string): ClassificationResult {
  const lower = message.toLowerCase();

  for (const pattern of INTENT_PATTERNS) {
    if (pattern.keywords.length === 0) continue;
    const matched = pattern.keywords.some((kw) => lower.includes(kw));
    if (matched) {
      return { intent: pattern.intent, confidence: 0.8 };
    }
  }

  return { intent: "general", confidence: 0.3 };
}
