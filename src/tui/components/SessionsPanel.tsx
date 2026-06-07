import { Box, Text } from "ink";
import React from "react";
import type { ConversationSession } from "../../services/memory/types.js";

interface SessionsPanelProps {
  sessions: ConversationSession[];
  currentSessionId: string;
}

export function SessionsPanel({ sessions, currentSessionId }: SessionsPanelProps) {
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} height={12}>
      <Text bold underline color="magenta">Сессии ({sessions.length})</Text>
      {sortedSessions.length === 0 && (
        <Text dimColor>Нет активных сессий</Text>
      )}
      {sortedSessions.slice(0, 10).map((session) => {
        const isCurrent = session.id === currentSessionId;
        const time = new Date(session.updatedAt).toLocaleString("ru-RU", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        return (
          <Text key={session.id}>
            {isCurrent
              ? <Text color="cyan">  → {session.id.slice(0, 30)}</Text>
              : <Text dimColor>     {session.id.slice(0, 30)}</Text>
            }
            <Text dimColor> ({session.messages.length} msgs, {time})</Text>
          </Text>
        );
      })}
      {sortedSessions.length > 10 && (
        <Text dimColor>  ... и ещё {sortedSessions.length - 10} сессий</Text>
      )}
    </Box>
  );
}
