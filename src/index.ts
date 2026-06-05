import "dotenv/config";
import { Agent } from "./services/ai/agent.js";
import { RAGService } from "./services/ai/rag/rag.service.js";
import { setVectorStore } from "./services/ai/tools/ask-codebase.tool.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1️⃣  Инициализируем RAG‑слой и получаем векторное хранилище
  const rag = new RAGService(__dirname);
  await rag.index(); // создаёт векторные эмбеддинги и сохраняет их в памяти
  const store = rag.getVectorStore(); // <-- возвращаем объект VectorStore

  // 2️⃣ Передаём одноразовый объект в инструмент ask_codebase
  setVectorStore(store);

  // 3️⃣ Создаём агента (в него уже «встроены» все инструменты, включая ask_codebase и finish)
  const agent = new Agent({
    workspaceRoot: process.cwd(),
    systemPrompt: `Ты – AI‑ассистент, работающий в рамках проекта. При любом вопросе о реализации кода сразу вызывай инструмент ask_codebase, а затем finish с готовым ответом. Не вызывай другие инструменты после ask_codebase.`,
    maxIterations: 5,
  });

  // 4️⃣ Пример диалога
  const userMessage = "Как работает ToolRegistry?";

  const answer = await agent.run(userMessage);
  console.log("\n===== Финальный ответ агента =====\n");
  console.log(answer);
}

main().catch(console.error);
