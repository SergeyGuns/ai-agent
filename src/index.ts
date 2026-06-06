import "dotenv/config";
import { SupervisorAgent } from "./agents/supervisor.js";
import { RAGService } from "./services/ai/rag/rag.service.js";
import { setVectorStore } from "./services/ai/tools/ask-codebase.tool.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("[Init] Индексация RAG-базы...");
  const rag = new RAGService(__dirname);
  await rag.index();
  setVectorStore(rag.vectorStore);
  console.log("[Init] RAG-база готова\n");

  const supervisor = new SupervisorAgent(process.cwd());

  const userMessage = "Как работает Orchestrator?";
  console.log("[User] " + userMessage + "\n");

  const answer = await supervisor.handle(userMessage);
  console.log("\n===== Ответ =====\n");
  console.log(answer);
}

main().catch(console.error);
