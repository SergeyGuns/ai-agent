import "dotenv/config";
import { VectorStore } from "./services/ai/rag/vector-store.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("=== RAG Debug ===\n");

  const workspaceRoot = path.resolve(__dirname, "..");
  const store = new VectorStore(workspaceRoot);

  // Индексируем
  console.log("Indexing...");
  const files = await store.indexDirectory(workspaceRoot);
  console.log(`Indexed ${files} files, ${store.size} chunks\n`);

  // Тестовые запросы
  const queries = [
    "ToolRegistry",
    "class ToolRegistry",
    "How does ToolRegistry work",
    "Agent class",
    "ask_codebase",
  ];

  for (const query of queries) {
    console.log(`\n--- Query: "${query}" ---`);
    const results = await store.search(query, 3);
    console.log("[DEBUG] Results count:", results.length);
    if (results.length > 0) {
      console.log("[DEBUG] First result similarity:", results[0].similarity);
    }
    if (results.length === 0) {
      console.log("  No results");
      continue;
    }

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(
        `\n  [${i + 1}] ${r.filePath}:${r.startLine}-${r.endLine} (sim: ${r.similarity.toFixed(3)}))`,
      );
      console.log(`  ${r.content.slice(0, 200)}...`);
    }
  }
}

main().catch(console.error);
