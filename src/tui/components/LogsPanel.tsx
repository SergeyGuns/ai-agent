import { Box, Text } from "ink";
import React from "react";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import type { TraceEvent } from "../types.js";

interface LogsPanelProps {
  supervisor: SupervisorAgent;
  events: TraceEvent[];
}

export function LogsPanel({ supervisor, events }: LogsPanelProps) {
  let entries: any[] = [];
  try {
    const logs = JSON.parse(supervisor.getLogs());
    entries = logs.slice(-15).reverse();
  } catch {
    entries = [];
  }

  // Merge with real-time trace events
  const recentEvents = events.slice(-5).map((e) => ({
    component: e.type,
    level: e.type === "error" ? "error" : "info",
    message: e.type === "classification"
      ? `Routing: ${e.data.intent} -> ${e.data.capability} (${(e.data.confidence as number)?.toFixed(2)})`
      : e.type === "agent_call"
        ? `Agent: ${e.data.agentId}`
        : e.type === "tool_call"
          ? `Tool: ${e.data.toolName}`
          : JSON.stringify(e.data).slice(0, 60),
    timestamp: e.timestamp,
  }));

  const allEntries = [...recentEvents, ...entries].slice(-20);

  const levelColor = (level: string) => {
    switch (level) {
      case "error": return "red";
      case "warn": return "yellow";
      case "info": return "cyan";
      case "debug": return "gray";
      default: return "white";
    }
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} height={12}>
      <Text bold underline color="gray">Логи (последние {allEntries.length})</Text>
      {allEntries.map((entry: any, i: number) => {
        const ts = new Date(entry.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        return (
          <Text key={i} wrap="truncate" maxWidth={120}>
            <Text color="gray">[{ts}]</Text>
            <Text color={levelColor(entry.level ?? "info")}> [{entry.level?.toUpperCase() ?? "INFO"}]</Text>
            <Text> {entry.message ?? entry.component ?? ""}</Text>
          </Text>
        );
      })}
      {allEntries.length === 0 && (
        <Text dimColor>Нет записей</Text>
      )}
    </Box>
  );
}
