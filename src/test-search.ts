import "dotenv/config";
import { ToolRegistry } from "./services/ai/tools/registry.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function main() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const registry = new ToolRegistry(workspaceRoot);

  console.log("=== Testing search_code ===\n");

  console.log('[Test 1] Поиск "AIService" в *.ts:');
  const result1 = await registry.execute("search_code", {
    query: "AIService",
    file_pattern: "*.ts",
  });
  console.log(result1);
  console.log("\nДлина:", result1.length, "символов\n");

  console.log('[Test 2] Поиск "function" в *.ts (ограничено):');
  const result2 = await registry.execute("search_code", {
    query: "function",
    file_pattern: "*.ts",
  });
  // Обрезаем для вывода
  console.log(result2.slice(0, 500));
  console.log("\nДлина:", result2.length, "символов\n");

  console.log('[Test 3] поиск "import" в src/services:');
  const result3 = await registry.execute("search_code", {
    query: "import",
    file_pattern: "*.ts",
  });
  console.log(result3.slice(0, 500));
  console.log("\nДлина:", result3.length, "символов\n");
}

main().catch(console.error);
