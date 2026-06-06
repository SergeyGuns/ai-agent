import * as http from "node:http";
import * as https from "node:https";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ===== web_search =====

export async function webSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
  // Пробуем несколько методов поиска
  const methods = [
    () => searchDuckDuckGoHTML(query, limit),
    () => searchDuckDuckGoLite(query, limit),
  ];

  for (const method of methods) {
    try {
      const results = await method();
      if (results.length > 0) return results;
    } catch (e) {
      console.error("[webSearch] Method failed:", (e as Error).message);
    }
  }

  return [];
}

async function searchDuckDuckGoHTML(query: string, limit: number): Promise<SearchResult[]> {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);

  const html = await fetchUrl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    timeout: 15000,
  });

  const results: SearchResult[] = [];

  // Парсим результаты поисковой выдачи DDG
  // Формат: <div class="result results_links results_links_deep web-result">
  const resultRegex = /<div class="result[^"]*">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
  let block;
  let count = 0;

  while ((block = resultRegex.exec(html)) !== null && count < limit) {
    const blockHtml = block[0];

    // Извлекаем ссылку и заголовок
    const titleMatch = blockHtml.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = blockHtml.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

    if (titleMatch) {
      let resultUrl = titleMatch[1];

      // DDG использует редирект через /l/?uddg=
      const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        resultUrl = decodeURIComponent(uddgMatch[1]);
      }

      results.push({
        url: resultUrl,
        title: stripHtml(titleMatch[2]),
        snippet: snippetMatch ? stripHtml(snippetMatch[1]) : "",
      });
      count++;
    }
  }

  return results;
}

async function searchDuckDuckGoLite(query: string, limit: number): Promise<SearchResult[]> {
  const url = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);

  const html = await fetchUrl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html",
    },
    timeout: 15000,
  });

  const results: SearchResult[] = [];

  // Lite версия проще — таблица с результатами
  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let row;
  let count = 0;

  while ((row = rowRegex.exec(html)) !== null && count < limit) {
    const rowHtml = row[0];

    // Ищем ссылку в строке
    const linkMatch = rowHtml.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = rowHtml.match(/<td class="result-snippet">([\s\S]*?)<\/td>/i);

    if (linkMatch && !linkMatch[1].includes("duckduckgo.com")) {
      results.push({
        url: linkMatch[1],
        title: stripHtml(linkMatch[2]),
        snippet: snippetMatch ? stripHtml(snippetMatch[1]) : "",
      });
      count++;
    }
  }

  return results;
}

// ===== fetch_page =====

export async function fetchPage(url: string, maxChars: number = 5000): Promise<string> {
  const html = await fetchUrl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    timeout: 15000,
    followRedirects: true,
    maxRedirects: 5,
  });

  return htmlToText(html, maxChars);
}

// ===== extract_links =====

export async function extractLinks(url: string): Promise<string[]> {
  const html = await fetchUrl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    timeout: 10000,
  });

  const links: string[] = [];
  const regex = /<a[^>]+href="([^"]+)"/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let href = match[1];
    // Пропускаем якоря и javascript
    if (href.startsWith("#") || href.startsWith("javascript:")) continue;

    // Относительные ссылки превращаем в абсолютные
    if (href.startsWith("/")) {
      try {
        const parsed = new URL(url);
        href = parsed.origin + href;
      } catch {
        continue;
      }
    }

    if (href.startsWith("http") && !href.includes("#")) {
      links.push(href);
    }
  }

  return Array.from(new Set(links)).slice(0, 50);
}

// ===== Утилиты =====

function fetchUrl(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeout?: number;
    followRedirects?: boolean;
    maxRedirects?: number;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.get(
      url,
      {
        headers: options.headers || {},
        timeout: options.timeout || 10000,
      },
      (res) => {
        // Обработка редиректов
        if (
          options.followRedirects !== false &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const redirectCount = (options.maxRedirects || 5) - 1;
          if (redirectCount <= 0) {
            reject(new Error("Too many redirects"));
            return;
          }
          fetchUrl(res.headers.location, { ...options, maxRedirects: redirectCount })
            .then(resolve)
            .catch(reject);
          return;
        }

        // Проверяем что ответ успешный
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
          reject(new Error("HTTP " + res.statusCode));
          return;
        }

        // Определяем кодировку
        const contentType = res.headers["content-type"] || "";
        const charsetMatch = contentType.match(/charset=([^;]+)/);
        const encoding = charsetMatch ? charsetMatch[1].trim() : "utf-8";

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          try {
            resolve(buffer.toString(encoding as BufferEncoding));
          } catch {
            resolve(buffer.toString("utf-8"));
          }
        });
        res.on("error", reject);
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout for " + url));
    });

    req.on("error", (e) => reject(new Error("Request failed: " + e.message)));
  });
}

function htmlToText(html: string, maxChars: number): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n... [обрезано]";
  }

  return text;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
