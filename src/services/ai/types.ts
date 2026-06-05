import OpenAI from "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OpenAI.Chat.ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

export type Tool = OpenAI.Chat.ChatCompletionTool;
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

export interface AgentConfig {
  maxIterations: number;
  systemPrompt: string;
  workspaceRoot: string;
}
