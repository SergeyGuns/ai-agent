import { describe, it, expect } from "vitest";
import { SemanticRouter, classify } from "../orchestrator/classifier.js";

describe("SemanticRouter", () => {
  const router = new SemanticRouter({ llmFallback: false });

  describe("keyword classification", () => {
    it("classifies web-search intent (Russian)", async () => {
      const result = await router.classify("поиск информации о TypeScript");
      expect(result.intent).toBe("web-search");
      expect(result.method).toBe("keyword");
    });

    it("classifies web-search intent (English)", async () => {
      const result = await router.classify("search for React documentation online");
      expect(result.intent).toBe("web-search");
      expect(result.method).toBe("keyword");
    });

    it("classifies web-search for 'что такое'", async () => {
      const result = await router.classify("что такое искусственный интеллект");
      expect(result.intent).toBe("web-search");
      expect(result.method).toBe("keyword");
    });

    it("classifies file-list intent", async () => {
      const result = await router.classify("покажи список файлов");
      expect(result.intent).toBe("file-list");
      expect(result.method).toBe("keyword");
    });

    it("classifies file-read intent", async () => {
      const result = await router.classify("прочитай файл README.md");
      expect(result.intent).toBe("file-read");
      expect(result.method).toBe("keyword");
    });

    it("classifies code-search intent", async () => {
      const result = await router.classify("найди функцию handleRequest в коде");
      expect(result.intent).toBe("code-search");
      expect(result.method).toBe("keyword");
    });

    it("classifies code-search for class search", async () => {
      const result = await router.classify("найди класс UserService");
      expect(result.intent).toBe("code-search");
      expect(result.method).toBe("keyword");
    });

    it("classifies browser intent", async () => {
      const result = await router.classify("открой сайт в браузере");
      expect(result.intent).toBe("browser");
      expect(result.method).toBe("keyword");
    });

    it("classifies fact-check intent", async () => {
      const result = await router.classify("проверь факт: Земля плоская");
      expect(result.intent).toBe("fact-check");
      expect(result.method).toBe("keyword");
    });

    it("classifies rag-query intent", async () => {
      const result = await router.classify("найди в базе знаний про архитектуру");
      expect(result.intent).toBe("rag-query");
      expect(result.method).toBe("keyword");
    });

    it("classifies rag-query for documentation", async () => {
      const result = await router.classify("поиск по документации про API");
      expect(result.intent).toBe("rag-query");
      expect(result.method).toBe("keyword");
    });

    it("returns general for unknown queries", async () => {
      const result = await router.classify("asdfghjkl");
      expect(result.intent).toBe("general");
      expect(result.method).toBe("fallback");
      expect(result.confidence).toBe(0.3);
    });

    it("returns general for ambiguous queries", async () => {
      const result = await router.classify("привет");
      expect(result.intent).toBe("general");
    });
  });

  describe("confidence scoring", () => {
    it("has higher confidence for more keyword matches", async () => {
      const specific = await router.classify("найди функцию handleRequest в коде TypeScript");
      const vague = await router.classify("код");
      expect(specific.confidence).toBeGreaterThanOrEqual(vague.confidence);
    });
  });

  describe("capability resolution", () => {
    it("resolves web-search intent to web-search capability", () => {
      expect(SemanticRouter.resolveCapability("web-search")).toBe("web-search");
    });

    it("resolves code-search intent to code-search capability", () => {
      expect(SemanticRouter.resolveCapability("code-search")).toBe("code-search");
    });

    it("resolves rag-query intent to retrieval capability", () => {
      expect(SemanticRouter.resolveCapability("rag-query")).toBe("retrieval");
    });

    it("resolves general intent to general capability", () => {
      expect(SemanticRouter.resolveCapability("general")).toBe("general");
    });

    it("returns general for unknown intent", () => {
      expect(SemanticRouter.resolveCapability("unknown-intent")).toBe("general");
    });
  });

  describe("backward compatibility", () => {
    it("classify function works without AI", async () => {
      const result = await classify("поиск чего-нибудь в интернете");
      expect(result.intent).toBe("web-search");
      expect(result.method).toBe("keyword");
    });
  });
});
