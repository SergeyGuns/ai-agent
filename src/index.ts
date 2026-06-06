import "dotenv/config";
import { WebResearchAgent } from "./agents/web-research/agent.js";
import * as path from "node:path";
import * as fs from "node:fs";

async function main() {
  const agent = new WebResearchAgent();

  const pdfPath = path.resolve(process.cwd(), "references", "qwen3_coder_next_tech_report.pdf");

  if (!fs.existsSync(pdfPath)) {
    console.error("[Error] PDF не найден: " + pdfPath);
    return;
  }

  console.log("[PDF] Path: " + pdfPath + "\n");

  const query = "Расскажи про Qwen3-Coder-Next. Сначала используй pdf_info чтобы узнать количество страниц, потом read_pdf чтобы прочитать страницы 1-5, затем 6-10, и наконец дай ответ через finish.";

  console.log("[User] " + query + "\n");

  const result = await agent.research(query, pdfPath);

  console.log("\n===== Результат =====\n");
  console.log(result.summary);
  console.log("\nИсточники: " + result.sources.length);
  console.log("Факты: " + result.facts.length);
  console.log("Уверенность: " + result.confidence + "%");
}

main().catch(console.error);
