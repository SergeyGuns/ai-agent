import { chromium, Browser, Page } from "playwright";

let browser: Browser | null = null;
let page: Page | null = null;

async function ensureBrowser(): Promise<Page> {
  if (!page) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
    });

    page = await context.newPage();

    // Скрываем признаки автоматизации
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en-US", "en"] });
      (window as any).chrome = { runtime: {} };
    });
  }

  return page;
}

export async function browserNavigate(url: string): Promise<string> {
  const p = await ensureBrowser();

  try {
    await p.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Ждём загрузки контента
    await p.waitForTimeout(2000);

    // Прокручиваем для имитации пользователя
    await p.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await p.waitForTimeout(500);

    const title = await p.title();
    const content = await p.evaluate(() => {
      // Убираем лишние элементы
      const selectors = ["script", "style", "nav", "footer", "header", "noscript", "iframe", "aside"];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }

      // Ищем основной контент
      const main =
        document.querySelector("main") ||
        document.querySelector("article") ||
        document.querySelector('[role="main"]') ||
        document.querySelector(".content") ||
        document.querySelector("#content") ||
        document.body;

      return main ? main.innerText : document.body.innerText;
    });

    const maxChars = 8000;
    const trimmed = content.length > maxChars ? content.slice(0, maxChars) + "\n... [обрезано]" : content;

    return `Title: ${title}\nURL: ${url}\n\n${trimmed}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function browserScreenshot(): Promise<string> {
  const p = await ensureBrowser();

  try {
    const buffer = await p.screenshot({ fullPage: false });
    const base64 = buffer.toString("base64");
    return `Screenshot saved (base64 length: ${base64.length})`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function browserExtractLinks(): Promise<string> {
  const p = await ensureBrowser();

  try {
    const links = await p.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
          text: a.textContent?.trim() || "",
          href: (a as HTMLAnchorElement).href,
        }))
        .filter((l) => l.href.startsWith("http") && !l.href.includes("#"));
    });

    const unique = links.filter((l, i, arr) => arr.findIndex((x) => x.href === l.href) === i);

    return unique
      .slice(0, 50)
      .map((l) => `${l.text} → ${l.href}`)
      .join("\n");
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function browserClick(selector: string): Promise<string> {
  const p = await ensureBrowser();

  try {
    await p.click(selector, { timeout: 10000 });
    await p.waitForTimeout(1000);
    return `Clicked: ${selector}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function browserType(selector: string, text: string): Promise<string> {
  const p = await ensureBrowser();

  try {
    await p.fill(selector, text);
    await p.waitForTimeout(500);
    return `Typed into ${selector}: ${text}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function browserWaitForSelector(selector: string, timeout: number = 10000): Promise<string> {
  const p = await ensureBrowser();

  try {
    await p.waitForSelector(selector, { timeout });
    return `Element found: ${selector}`;
  } catch (e: any) {
    return `Timeout waiting for: ${selector}`;
  }
}

export async function browserEvaluate(script: string): Promise<string> {
  const p = await ensureBrowser();

  try {
    const result = await p.evaluate(script);
    return String(result);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function browserClose(): Promise<string> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    return "Browser closed";
  }
  return "No browser open";
}

// Обход защит (образовательный)

export async function bypassCloudflare(url: string): Promise<string> {
  const p = await ensureBrowser();

  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Ждём прохождения Cloudflare challenge
    for (let i = 0; i < 10; i++) {
      await p.waitForTimeout(2000);

      const title = await p.title();
      if (!title.includes("Just a moment") && !title.includes("Attention Required")) {
        return `Bypass successful. Title: ${title}`;
      }

      // Пытаемся найти и нажать кнопку верификации
      const checkbox = await p.$('input[type="checkbox"]');
      if (checkbox) {
        await checkbox.click();
        await p.waitForTimeout(3000);
      }
    }

    return "Could not bypass automatically";
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function solveCaptcha(imageBase64: string): Promise<string> {
  // Заглушка — реальное решение требует сервиса (2captcha, anti-captcha)
  return "CAPTCHA solving requires external service (2captcha, anti-captcha)";
}
