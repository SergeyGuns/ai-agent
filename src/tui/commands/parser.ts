/**
 * Парсер пользовательских команд TUI.
 * Все команды начинаются с /.
 */

export interface ParsedCommand {
  type: "command";
  name: string;
  args: string[];
  raw: string;
}

export interface ParsedMessage {
  type: "message";
  content: string;
}

export type ParsedInput = ParsedCommand | ParsedMessage;

/**
 * Доступные команды TUI.
 */
export const AVAILABLE_COMMANDS = [
  { name: "help", description: "Показать справку по командам" },
  { name: "exit", description: "Выйти из TUI" },
  { name: "quit", description: "Выйти из TUI" },
  { name: "history", description: "Показать историю текущей сессии" },
  { name: "sessions", description: "Список всех сессий" },
  { name: "session", description: "Переключить сессию: /session <id>" },
  { name: "new", description: "Создать новую сессию" },
  { name: "clear", description: "Очистить историю текущей сессии" },
  { name: "agent", description: "Инфо об агенте: /agent <id>" },
  { name: "agents", description: "Список всех агентов" },
  { name: "health", description: "Проверить здоровье агентов" },
  { name: "metrics", description: "Показать системные метрики" },
  { name: "eval", description: "Запустить offline evaluation" },
  { name: "export", description: "Экспорт данных: /export <metrics|logs|audit|history>" },
  { name: "logs", description: "Показать последние логи" },
  { name: "status", description: "Статус системы" },
] as const;

/**
 * Распарсить ввод пользователя.
 * Если начинается с / — это команда, иначе — сообщение агенту.
 */
export function parseInput(input: string): ParsedInput {
  const trimmed = input.trim();

  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0]?.toLowerCase() ?? "";
    const args = parts.slice(1);
    return { type: "command", name, args, raw: trimmed };
  }

  return { type: "message", content: trimmed };
}

/**
 * Генерация текста справки.
 */
export function generateHelp(): string {
  const lines = [
    "=== Доступные команды ===",
    "",
  ];

  for (const cmd of AVAILABLE_COMMANDS) {
    lines.push(`  /${cmd.name.padEnd(12)} — ${cmd.description}`);
  }

  lines.push("");
  lines.push("  Любой другой текст отправляется агенту на обработку.");
  lines.push("  Ctrl+C или /exit — выход.");

  return lines.join("\n");
}
