import { Box, Text } from "ink";
import React from "react";

interface StatusBarProps {
  processing: boolean;
  agentCount: number;
  sessionCount: number;
  messageCount: number;
}

export function StatusBar({ processing, agentCount, sessionCount, messageCount }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>
        {processing
          ? <Text color="yellow">⏳ Обработка...</Text>
          : <Text color="green">● Готов</Text>
        }
        {" | "}
        Агенты: {agentCount}
        {" | "}
        Сессии: {sessionCount}
        {" | "}
        Сообщений: {messageCount}
      </Text>
    </Box>
  );
}
