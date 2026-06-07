import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import type { ProcessingState } from "../types.js";

interface ProgressBarProps {
  active: boolean;
  agentId?: string;
  toolCount: number;
  startTime: number;
}

export function ProgressBar({ active, agentId, toolCount, startTime }: ProgressBarProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 200);
    return () => clearInterval(interval);
  }, [active, startTime]);

  if (!active) return null;

  const seconds = (elapsed / 1000).toFixed(1);
  const progressChars = 20;
  const filledChars = Math.min(progressChars, Math.floor(elapsed / 500));
  const bar = "█".repeat(filledChars) + "░".repeat(progressChars - filledChars);

  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text color="yellow"> ⏳ Обработка запроса... {seconds}s</Text>
      {agentId && <Text color="cyan"> | 🤖 {agentId}</Text>}
      {toolCount > 0 && <Text color="blue"> | 🔧 Tools: {toolCount}</Text>}
      <Text dimColor> | [{bar}]</Text>
    </Box>
  );
}
