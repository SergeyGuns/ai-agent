import { Box, Text } from "ink";
import React from "react";
import type { SupervisorAgent } from "../../agents/supervisor.js";

interface MetricsPanelProps {
  supervisor: SupervisorAgent;
}

export function MetricsPanel({ supervisor }: MetricsPanelProps) {
  let metricsData: any = null;
  try {
    metricsData = JSON.parse(supervisor.getMetrics());
  } catch {
    metricsData = { system: {}, agents: [], tools: [] };
  }

  const sys = metricsData.system;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} height={12}>
      <Text bold underline color="yellow">Метрики</Text>

      <Text bold>Система:</Text>
      <Text>  Запросов: <Text color="cyan">{sys.totalRequests ?? 0}</Text></Text>
      <Text>  Ошибок: <Text color={sys.totalErrors > 0 ? "red" : "green"}>{sys.totalErrors ?? 0}</Text></Text>
      <Text>  Error Rate: <Text color={sys.totalRequests > 0 ? ((sys.totalErrors / sys.totalRequests) > 0.1 ? "red" : "green") : "cyan"}>
        {sys.totalRequests > 0 ? ((sys.totalErrors / sys.totalRequests) * 100).toFixed(1) + "%" : "N/A"}
      </Text></Text>
      <Text>  Сессий: {sys.activeSessions ?? 0}</Text>
      <Text>  Токенов использовано: {sys.totalTokensUsed ?? 0}</Text>
      <Text>  Токенов сгенерировано: {sys.totalTokensGenerated ?? 0}</Text>

      {metricsData.agents && metricsData.agents.length > 0 && (
        <>
          <Text bold>Агенты:</Text>
          {metricsData.agents.map((a: any) => (
            <Text key={a.agentId}>
              {" "}{a.agentId}: {a.calls} calls, {a.errors} errors, avg {a.totalDurationMs > 0 ? Math.round(a.totalDurationMs / a.calls) : 0}ms
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}
