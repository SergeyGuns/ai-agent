import { ToolDefinition } from "../types.js";

export const finishTool: ToolDefinition = {
  tool: {
    type: "function",
    function: {
      name: "finish",
      description: "Завершить диалог и вернуть финальный ответ",
      parameters: {
        type: "object",
        properties: {
          answer: { type: "string", description: "Финальный ответ пользователю" },
        },
        required: ["answer"],
      },
    },
  },
  handler: async (args) => {
    return (args.answer as string) || "Done";
  },
};
