import { AIService } from "../../services/ai/service.js";
import { Tool, ChatMessage } from "../../services/ai/types.js";
import { webSearch, fetchPage, extractLinks } from "./web-tools.js";
import {
  browserNavigate,
  browserScreenshot,
  browserExtractLinks,
  browserClick,
  browserType,
  bypassCloudflare,
} from "./browser-tools.js";
import { verifyFact, crossReference, summarizeSources } from "./fact-tools.js";
import {
  extractPdfText,
  extractPdfPages,
  extractPdfPageRange,
  getPdfInfo,
  chunkPdfText,
} from "./pdf-tools.js";

export interface ResearchResult {
  query: string;
  sources: Source[];
  facts: Fact[];
  summary: string;
  confidence: number;
}

export interface Source {
  url: string;
  title: string;
  content: string;
  method: "search" | "scrape" | "browser" | "api";
  timestamp: Date;
}

export interface Fact {
  claim: string;
  sources: string[];
  verified: boolean;
}

interface ToolCallLog {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

function buildSystemPrompt(pdfPath?: string): string {
  const pdfSection = pdfPath
    ? `
=== PDF ДОКУМЕНТ ДОСТУПЕН ===
Путь: ${pdfPath}
ПРИОРИТЕТ: Если вопрос связан с документом — НАЧНИ С PDF!
1. pdf_info(pdf_path="${pdfPath}") — узнать количество страниц
2. read_pdf(pdf_path="${pdfPath}", start_page=N, end_page=M) — читать по 5 страниц
3. После прочтения нужных страниц — finish(answer)
`
    : "";

  const webSection = pdfPath
    ? `Если информации из PDF недостаточно, используй веб-поиск:`
    : `ОБЯЗАТЕЛЬНЫЙ ПОРЯДОК:`;

  return `Ты — Web Research Agent. Находишь информацию из документов и интернета.
${pdfSection}
${webSection}
1. web_search(query) — поиск DuckDuckGo
2. fetch_page(url) — загрузить 2-3 страницы
3. finish(answer) — завершить с ответом

КРИТИЧЕСКИ ВАЖНО:
- НЕ вызывай finish без данных! Сначала прочитай PDF или загрузи страницы.
- В ответе указывай источники (URL или номер страницы PDF).

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
- pdf_info, read_pdf — работа с PDF (читать по 5 страниц!)
- web_search, fetch_page, extract_links — веб-поиск
- browser_navigate, browser_click, browser_type — headless браузер
- verify_fact, cross_reference, summarize_sources — анализ
- finish(answer) — завершить (ОБЯЗАТЕЛЬНО как tool_call!)`;
}

export class WebResearchAgent {
  private ai: AIService;
  private sources: Source[] = [];
  private facts: Fact[] = [];
  private toolLog: ToolCallLog[] = [];
  private pendingSearchResults: { title: string; url: string; snippet: string }[] = [];
  private readPdfCount = 0;
  private maxReadPdf = 6;

  constructor() {
    this.ai = new AIService();
  }

  async research(query: string, pdfPath?: string): Promise<ResearchResult> {
    this.sources = [];
    this.facts = [];
    this.toolLog = [];
    this.pendingSearchResults = [];
    this.readPdfCount = 0;

    const tools = this.buildTools();
    const toolManifests = tools.map((t) => t.tool);

    const systemPrompt = buildSystemPrompt(pdfPath);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: pdfPath
          ? `Вопрос: ${query}\n\nВ приоритетe — прочитай PDF документ. Используй pdf_info и read_pdf.`
          : `Исследуй: ${query}\n\nПлан:\n1. web_search\n2. fetch_page (2-3 страницы)\n3. finish с ответом и источниками`,
      },
    ];

    while (true) {
      const response = await this.ai.completeWithTools(messages, toolManifests);
      const choice = response.choices[0];
      const message = choice.message;

      if (choice.finish_reason === "tool_calls" && message.tool_calls) {
        messages.push({
          role: "assistant",
          content: message.content || "",
          tool_calls: message.tool_calls,
        });

        for (const tc of message.tool_calls) {
          if (tc.type !== "function") continue;

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            /* skip */
          }

          const toolName = tc.function.name;
          console.log("[WebResearch] " + toolName);

          if (toolName === "finish") {
            const answer = (args.answer || args.response || "") as string;
            // Если PDF был — источники не обязательны (данные из PDF)
            if (pdfPath) {
              return this.buildResult(query, answer);
            }
            // Для веб-поиска — минимум 2 источника
            if (this.sources.length < 2) {
              console.log("[WebResearch] Мало источников (" + this.sources.length + "), продолжаем сбор...");
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: "Недостаточно источников. Загрузи ещё страницы через fetch_page перед ответом.",
              });
              continue;
            }
            return this.buildResult(query, answer);
          }

          const tool = tools.find((t) => t.tool.function.name === toolName);
          let result = "Unknown tool: " + toolName;

          if (tool) {
            try {
              result = await tool.handler(args, this);
            } catch (e: any) {
              result = "Error: " + e.message;
            }
          }

          this.toolLog.push({ name: toolName, args, result });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result.slice(0, 4000),
          });

          // LoopDetector каждые 10 шагов
          if (this.toolLog.length > 0 && this.toolLog.length % 10 === 0) {
            const recentLogs = this.toolLog.slice(-5);
            const check = await this.checkLoop(query, recentLogs);
            if (check.isLoop || check.shouldFinish) {
              return this.buildResult(query, "");
            }
          }
        }
        continue;
      }

      return this.buildResult(query, message.content || "Нет ответа");
    }
  }

  addSource(url: string, title: string, content: string, method: Source["method"]) {
    // Дедупликация
    if (this.sources.some((s) => s.url === url)) return;
    this.sources.push({ url, title, content, method, timestamp: new Date() });
  }

  getSources(): Source[] {
    return this.sources;
  }

  private buildTools(): { tool: Tool; handler: (args: Record<string, unknown>, agent: WebResearchAgent) => Promise<string> }[] {
    return [
      {
        tool: {
          type: "function",
          function: {
            name: "web_search",
            description: "Поиск в интернете через DuckDuckGo. Возвращает список результатов [title, url, snippet]",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Поисковый запрос" },
                limit: { type: "number", description: "Максимум результатов", default: 10 },
              },
              required: ["query"],
            },
          },
        },
        handler: async (args, agent) => {
          const results = await webSearch(args.query as string, (args.limit as number) || 10);
          // Сохраняем для последующего использования
          agent.pendingSearchResults = results;
          if (results.length === 0) {
            return "Результаты не найдены. Попробуй другой запрос.";
          }
          return results.map((r, i) => "[" + (i + 1) + "] " + r.title + "\n    URL: " + r.url + "\n    " + r.snippet).join("\n\n");
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "fetch_page",
            description: "Получить текстовое содержимое веб-страницы. Используй URL из web_search.",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "URL страницы" },
                max_chars: { type: "number", description: "Максимум символов", default: 5000 },
              },
              required: ["url"],
            },
          },
        },
        handler: async (args, agent) => {
          const url = args.url as string;
          const maxChars = (args.max_chars as number) || 5000;
          const content = await fetchPage(url, maxChars);
          // Находим title из pending search results
          const searchResult = agent.pendingSearchResults.find((r) => r.url === url);
          const title = searchResult ? searchResult.title : url;
          agent.addSource(url, title, content, "scrape");
          return content;
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "extract_links",
            description: "Извлечь все ссылки с веб-страницы",
            parameters: {
              type: "object",
              properties: { url: { type: "string", description: "URL страницы" } },
              required: ["url"],
            },
          },
        },
        handler: async (args) => {
          const links = await extractLinks(args.url as string);
          return links.join("\n");
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "browser_navigate",
            description: "Открыть страницу в headless браузере (для JS-рендеринга)",
            parameters: {
              type: "object",
              properties: { url: { type: "string", description: "URL страницы" } },
              required: ["url"],
            },
          },
        },
        handler: async (args, agent) => {
          const url = args.url as string;
          const content = await browserNavigate(url);
          agent.addSource(url, url, content, "browser");
          return content;
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "browser_screenshot",
            description: "Сделать скриншот текущей страницы в браузере",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async () => browserScreenshot(),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "browser_extract_links",
            description: "Извлечь ссылки из текущей страницы браузера",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async () => browserExtractLinks(),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "browser_click",
            description: "Кликнуть на элемент страницы",
            parameters: {
              type: "object",
              properties: { selector: { type: "string", description: "CSS селектор" } },
              required: ["selector"],
            },
          },
        },
        handler: async (args) => browserClick(args.selector as string),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "browser_type",
            description: "Ввести текст в поле ввода",
            parameters: {
              type: "object",
              properties: {
                selector: { type: "string", description: "CSS селектор поля" },
                text: { type: "string", description: "Текст" },
              },
              required: ["selector", "text"],
            },
          },
        },
        handler: async (args) => browserType(args.selector as string, args.text as string),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "bypass_cloudflare",
            description: "Попытаться обойти Cloudflare protection",
            parameters: {
              type: "object",
              properties: { url: { type: "string", description: "URL" } },
              required: ["url"],
            },
          },
        },
        handler: async (args) => bypassCloudflare(args.url as string),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "verify_fact",
            description: "Кросс-проверка факта по источникам",
            parameters: {
              type: "object",
              properties: {
                claim: { type: "string", description: "Утверждение" },
                sources: { type: "array", items: { type: "string" }, description: "Источники" },
              },
              required: ["claim", "sources"],
            },
          },
        },
        handler: async (args, agent) => {
          const result = await verifyFact(agent.ai, args.claim as string, (args.sources as string[]) || []);
          if (result.verdict === "confirmed") {
            agent.facts.push({ claim: result.claim, sources: result.sources, verified: true });
          }
          return JSON.stringify(result, null, 2);
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "cross_reference",
            description: "Сравнить информацию из источников",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Запрос" },
                results: { type: "array", items: { type: "string" }, description: "Тексты" },
              },
              required: ["query", "results"],
            },
          },
        },
        handler: async (args, agent) =>
          crossReference(agent.ai, args.query as string, (args.results as string[]) || []),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "summarize_sources",
            description: "Сводка по источникам",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Запрос" },
                sources: { type: "array", items: { type: "string" }, description: "Тексты" },
              },
              required: ["query", "sources"],
            },
          },
        },
        handler: async (args, agent) =>
          summarizeSources(agent.ai, (args.sources as string[]) || [], args.query as string),
      },
      // === PDF Tools ===
      {
        tool: {
          type: "function",
          function: {
            name: "read_pdf",
            description: "Извлечь текст из PDF файла. ВАЖНО: всегда указывай start_page и end_page чтобы не переполнить контекст. Читай по 5-10 страниц за раз.",
            parameters: {
              type: "object",
              properties: {
                pdf_path: { type: "string", description: "Путь к PDF файлу" },
                start_page: { type: "number", description: "Начальная страница (обязательно)" },
                end_page: { type: "number", description: "Конечная страница (обязательно)" },
              },
              required: ["pdf_path", "start_page", "end_page"],
            },
          },
        },
        handler: async (args) => {
          const pdfPath = args.pdf_path as string;
          const startPage = args.start_page as number;
          const endPage = args.end_page as number;

          try {
            if (!startPage || !endPage) {
              return "Ошибка: укажи start_page и end_page. Не читай весь PDF сразу — контекст переполнится!";
            }
            const pageCount = endPage - startPage + 1;
            if (pageCount > 10) {
              return "Ошибка: слишком много страниц за раз (" + pageCount + "). Максимум 10 страниц.";
            }
            this.readPdfCount++;
            if (this.readPdfCount >= this.maxReadPdf) {
              return "Достигнут лимит чтения PDF (" + this.maxReadPdf + " вызовов). Используй finish(answer) чтобы дать ответ на основе прочитанного.";
            }
            const text = extractPdfPageRange(pdfPath, startPage, endPage);
            return "Страницы " + startPage + "-" + endPage + " (вызов " + this.readPdfCount + "/" + this.maxReadPdf + "):\n" + text;
          } catch (e: any) {
            return "Error: " + e.message;
          }
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "pdf_info",
            description: "Получить информацию о PDF файле (количество страниц, размер)",
            parameters: {
              type: "object",
              properties: {
                pdf_path: { type: "string", description: "Путь к PDF файлу" },
              },
              required: ["pdf_path"],
            },
          },
        },
        handler: async (args) => {
          try {
            const info = getPdfInfo(args.pdf_path as string);
            return "Pages: " + info.pages + ", Size: " + (info.size / 1024).toFixed(0) + " KB";
          } catch (e: any) {
            return "Error: " + e.message;
          }
        },
      },
      // === finish tool ===
      {
        tool: {
          type: "function",
          function: {
            name: "finish",
            description: "Завершить исследование и дать финальный ответ. Вызывай ТОЛЬКО когда собрал достаточно данных из PDF или веб-источников.",
            parameters: {
              type: "object",
              properties: {
                answer: { type: "string", description: "Финальный ответ с указанием источников" },
              },
              required: ["answer"],
            },
          },
        },
        handler: async (args) => {
          // finish обрабатывается в цикле — здесь просто возвращаем ответ
          return "DONE: " + (args.answer || "");
        },
      },
    ];
  }

  private async checkLoop(
    query: string,
    recentLogs: ToolCallLog[],
  ): Promise<{ isLoop: boolean; shouldFinish: boolean }> {
    const logSummary = recentLogs
      .map((t, i) => "[" + (i + 1) + "] " + t.name + " → " + t.result.slice(0, 200))
      .join("\n");

    const prompt =
      "Задача: " + query + "\n\nПоследние действия:\n" + logSummary +
      "\n\nЕсть ли зацикливание? Достаточно ли данных?\n" +
      '{"loop": true/false, "finish": true/false, "reason": ""}';

    try {
      const response = await this.ai.complete("Ответь JSON.", prompt, { temperature: 1, maxTokens: 200 });
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { isLoop: parsed.loop === true, shouldFinish: parsed.finish === true };
      }
    } catch {
      /* ignore */
    }

    return { isLoop: false, shouldFinish: false };
  }

  private buildResult(query: string, summary: string): ResearchResult {
    // Если мало источлов — генерируем сводку
    if (this.sources.length === 0 && summary) {
      summary = summary + "\n\n⚠️ Источники не были загружены. Информация может быть неточной.";
    }

    return {
      query,
      sources: this.sources,
      facts: this.facts,
      summary,
      confidence: this.sources.length > 0 ? Math.min(0.4 + this.sources.length * 0.15, 1.0) : 0.2,
    };
  }
}
