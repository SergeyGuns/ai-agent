import { z } from "zod";

export const TaskSchema = z.object({
  title: z.string().describe("Краткое название задачи (3-7 слов)"),
  description: z.string().describe("Подробное описание задачи"),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .describe("Приоритет задачи"),
  type: z
    .enum(["feature", "bug_fix", "bug", "refactor", "docs", "test"])
    .describe("Тип задачи"),
  affectedFiles: z.array(z.string()).describe("Файлы, которые затронет задача"),
  estimatedComplexity: z
    .enum(["trivial", "easy", "medium", "hard"])
    .describe("Оценка сложности"),
});

export type Task = z.infer<typeof TaskSchema>;
