import { Box, Text } from "ink";
import React from "react";
import type { AgentHealth } from "../../registry/monitor.js";
import { loadRegistry } from "../../registry/registry.js";
import type { AgentYamlDescriptor } from "../../registry/registry.js";

interface AgentsPanelProps {
  health: AgentHealth[];
}

export function AgentsPanel({ health }: AgentsPanelProps) {
  const registry = loadRegistry();

  const statusIcon = (status: string) => {
    switch (status) {
      case "active": return "✅";
      case "degraded": return "⚠️";
      case "inactive": return "❌";
      default: return "❓";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "green";
      case "degraded": return "yellow";
      case "inactive": return "red";
      default: return "gray";
    }
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1} height={12}>
      <Text bold underline color="green">Агенты ({health.length})</Text>
      {registry.map((agent: AgentYamlDescriptor) => {
        const h = health.find((h) => h.agentId === agent.id);
        const status = h?.status ?? agent.status ?? "unknown";
        return (
          <Box key={agent.id} flexDirection="column">
            <Text>
              <Text color={statusColor(status)}>{statusIcon(status)}</Text>
              <Text bold> {agent.name}</Text>
              <Text dimColor> ({agent.id})</Text>
              <Text dimColor> v{agent.version}</Text>
            </Text>
            <Text dimColor>   Capabilities: {agent.capabilities.join(", ")}</Text>
            {h && (
              <Text dimColor>
                {" "}Checks: {h.totalChecks} | Errors: {h.totalFailures} | Avg: {Math.round(h.avgResponseMs)}ms
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
