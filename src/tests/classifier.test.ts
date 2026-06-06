import { describe, it, expect } from "vitest";
import { classify } from "../orchestrator/classifier.js";

describe("Classifier", () => {
  it("classifies code-search intent", () => {
    const result = classify("Как работает функция process?");
    expect(result.intent).toBe("code-search");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifies file-read intent", () => {
    const result = classify("Покажи содержимое файла index.ts");
    expect(result.intent).toBe("file-read");
  });

  it("classifies file-list intent", () => {
    const result = classify("Список файлов в директории src");
    expect(result.intent).toBe("file-list");
  });

  it("returns general for unknown", () => {
    const result = classify("Привет, как дела?");
    expect(result.intent).toBe("general");
  });
});
