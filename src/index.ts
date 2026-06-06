import "dotenv/config";
import { SupervisorAgent } from "./agents/supervisor.js";
import * as path from "node:path";
import * as fs from "node:fs";

async function main() {
  const supervisor = new SupervisorAgent();

  const pdfPath = path.resolve(process.cwd(), "references", "qwen3_coder_next_tech_report.pdf");

  if (!fs.existsSync(pdfPath)) {
    console.error("[Error] PDF не найден: " + pdfPath);
    return;
  }

  // Тест 1: Первый запрос (новая сессия)
  console.log("=== Тест 1: Первый запрос ===");
  const session1 = "test-session-1";
  const q1 = "Расскажи про Qwen3-Coder-Next. Используй pdf_info и read_pdf.";
  console.log("[User] " + q1);
  const a1 = await supervisor.handle(q1, session1);
  console.log("\n[Answer]\n" + a1 + "\n");

  // Тест 2: Второй запрос в ту же сессию (контекст должен сохраниться)
  console.log("=== Тест 2: Второй запрос (та же сессия) ===");
  const q2 = "Какие бенчмарки упоминаются?";
  console.log("[User] " + q2);
  const a2 = await supervisor.handle(q2, session1);
  console.log("\n[Answer]\n" + a2 + "\n");

  // Тест 3: Веб-поиск (новая сессия)
  console.log("=== Тест 3: Веб-поиск ===");
  const session2 = "test-session-2";
  const q3 = "Какие новые функции в TypeScript 5.0?";
  console.log("[User] " + q3);
  const a3 = await supervisor.handle(q3, session2);
  console.log("\n[Answer]\n" + a3 + "\n");

  // Вывод метрик
  console.log("\n=== Метрики ===");
  console.log(supervisor.getMetrics());

  // Вывод истории сессии
  console.log("\n=== История сессии " + session1 + " ===");
  const history = supervisor.getConversationHistory(session1);
  for (const msg of history) {
    console.log("[" + msg.role + "] " + msg.content.slice(0, 100) + "...");
  }

  // Вывод активных сессий
  console.log("\n=== Активные сессии ===");
  const sessions = supervisor.listSessions();
  for (const s of sessions) {
    console.log("Session: " + s.id + ", messages: " + s.messages.length);
  }
}

main().catch(console.error);
