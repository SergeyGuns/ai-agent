import { ToolDefinition } from "../types.js";

export const finishTool: ToolDefinition = {
  tool: {
    type: "function",
    function: {
      name: "finish",
      description:
        "Завершить работу и вернуть ответ. Вызывай когда задача выполнена.",
      parameters: {
        type: "object",
        properties: {
          answer: { type: "string", description: "Ответ пользователю" },
        },
        required: ["answer"],
      },
    },
  },
  handler: async (args): Promise<string> => {
    // Принимаем и answer, и response (модель путает)
    const text = (args.answer || args.response || args.result || "") as string;
    return `FINISH:${text}`;
  },
};
